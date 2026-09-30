import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../utils/logger.js";
import { encrypt, decrypt } from "../utils/encryption.js";
import { nextHourStartMs } from "./rate-limit.service.js";
import {
  codeChallengeFor,
  exchangeSlackCode,
  newCodeVerifier,
  postSlackWebhook,
} from "../integrations/slack.js";

// OAuth state: unpredictable, expiring, bound to the user, single-use.
// The record also carries the PKCE verifier as one JSON value with the same
// 10-minute TTL. Only the random state travels in the URL; the userId and
// the verifier stay server-side and are never logged or returned.
interface SlackOAuthRecord {
  userId: string;
  codeVerifier: string;
}

const oauthClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
oauthClient.on("error", () => {});
const oauthKey = (state: string) => `slack:oauth:${state}`;

export const newSlackOAuthState = async (
  userId: string
): Promise<{ state: string; codeChallenge: string }> => {
  const state = randomUUID();
  const codeVerifier = newCodeVerifier();
  const record: SlackOAuthRecord = { userId, codeVerifier };
  await oauthClient.set(oauthKey(state), JSON.stringify(record), "EX", 600);
  return { state, codeChallenge: codeChallengeFor(codeVerifier) };
};

export const consumeSlackOAuthState = async (
  state: string
): Promise<SlackOAuthRecord | null> => {
  const found = await oauthClient.get(oauthKey(state));
  if (!found) return null;
  await oauthClient.del(oauthKey(state));
  try {
    const record = JSON.parse(found) as Partial<SlackOAuthRecord>;
    if (typeof record.userId !== "string" || typeof record.codeVerifier !== "string")
      return null;
    return { userId: record.userId, codeVerifier: record.codeVerifier };
  } catch {
    return null; // pre-PKCE or corrupt records fail closed, never honored
  }
};

// Upsert preserves the userId-unique invariant: reconnect replaces, never duplicates.
export const connectSlack = async (
  userId: string,
  code: string,
  codeVerifier: string
): Promise<{ teamId: string }> => {
  const { teamId, webhookUrl } = await exchangeSlackCode(code, codeVerifier);
  await prisma.slackConnection.upsert({
    where: { userId },
    create: { userId, teamId, accessToken: encrypt(webhookUrl) },
    update: { teamId, accessToken: encrypt(webhookUrl) },
  });
  return { teamId };
};

export const disconnectSlack = async (userId: string): Promise<void> => {
  await prisma.slackConnection.deleteMany({ where: { userId } });
};

export const getSlackStatus = async (
  userId: string
): Promise<{ connected: false } | { connected: true; teamId: string; connectedAt: string }> => {
  const conn = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!conn) return { connected: false };
  return { connected: true, teamId: conn.teamId, connectedAt: conn.updatedAt.toISOString() };
};

// One notification per sender per UTC hour, claimed atomically so N workers
// produce exactly one message. TTL outlives the window; a lost send after a
// successful claim is accepted (no spam) rather than retried into duplicates.
export const notifyDedupeKey = (senderId: string, window: string) =>
  `slack:notified:${senderId}:${window}`;
export const notifyDedupeTtlSeconds = (nowMs: number): number =>
  Math.ceil((nextHourStartMs(nowMs) - nowMs) / 1000) + 60;

export const buildRateLimitMessage = (input: {
  senderEmail: string;
  limit: number;
  retryAtMs: number;
}): string =>
  `Hourly email limit reached for ${input.senderEmail} (${input.limit}/hour). ` +
  `Queued emails are being rescheduled; next window starts at ${new Date(input.retryAtMs).toISOString()}.`;

export interface RateLimitNotifyInput {
  senderId: string;
  senderEmail: string;
  limit: number;
  window: string;
  retryAtMs: number;
  emailId: string;
  jobId?: string;
}

// Best-effort by contract: NEVER throws. Slack failure must not fail, delay,
// or resend the email job — the caller reschedules unconditionally.
export const notifyHourlyLimit = async (input: RateLimitNotifyInput): Promise<void> => {
  try {
    const sender = await prisma.sender.findUnique({ where: { id: input.senderId } });
    const conn = sender
      ? await prisma.slackConnection.findUnique({ where: { userId: sender.userId } })
      : null;
    if (!conn) {
      logger.info({ emailId: input.emailId, senderId: input.senderId }, "slack skipped: no connection");
      return;
    }
    const claimed = await oauthClient.set(
      notifyDedupeKey(input.senderId, input.window),
      "1",
      "EX",
      notifyDedupeTtlSeconds(Date.now()),
      "NX"
    );
    if (claimed !== "OK") {
      logger.info(
        { emailId: input.emailId, senderId: input.senderId, window: input.window },
        "slack skipped: already notified this hour"
      );
      return;
    }
    await postSlackWebhook(
      decrypt(conn.accessToken),
      buildRateLimitMessage({ senderEmail: input.senderEmail, limit: input.limit, retryAtMs: input.retryAtMs })
    );
    logger.info(
      { emailId: input.emailId, senderId: input.senderId, jobId: input.jobId, window: input.window },
      "slack hourly-limit notification sent"
    );
  } catch (err) {
    logger.error({ emailId: input.emailId, senderId: input.senderId, err }, "slack notification failed");
  }
};
