import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// Per-sender pacing in Redis: slot pointer + hourly counter (UTC YYYYMMDDHH).
// Keys: rl:sender:{id}:next, rl:sender:{id}:hour:{window}, rl:email:{id}:slot.

const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
client.on("error", (err) => logger.error({ err }, "rate-limit redis error"));

export const nextSendKey = (senderId: string) => `rl:sender:${senderId}:next`;
export const hourCounterKey = (senderId: string, window: string) =>
  `rl:sender:${senderId}:hour:${window}`;
export const emailSlotKey = (emailId: string) => `rl:email:${emailId}:slot`;
const EMAIL_SLOT_TTL_SECONDS = 7 * 24 * 3600;

export const getEmailSlot = async (emailId: string): Promise<number | null> => {
  const raw = await client.get(emailSlotKey(emailId));
  const ms = raw === null ? NaN : Number(raw);
  return Number.isFinite(ms) ? ms : null;
};

export const setEmailSlot = async (emailId: string, slotMs: number): Promise<void> => {
  await client.set(emailSlotKey(emailId), String(slotMs), "EX", EMAIL_SLOT_TTL_SECONDS);
};

export const clearEmailSlot = async (emailId: string): Promise<void> => {
  await client.del(emailSlotKey(emailId));
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export const hourWindowFor = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}`;
};

export const nextHourStartMs = (ms: number): number => {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime() + 3_600_000;
};

// Next send slot per sender; concurrent workers each get a distinct slot.
const SLOT_SCRIPT = `
local nextAvail = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(tonumber(ARGV[1]), tonumber(ARGV[2]), nextAvail)
redis.call('SET', KEYS[1], tostring(slot + tonumber(ARGV[3])))
return tostring(slot)
`;

// Hourly quota: consume one unit only if quota remains.
const QUOTA_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count < tonumber(ARGV[1]) then
  local n = redis.call('INCR', KEYS[1])
  if redis.call('TTL', KEYS[1]) == -1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  end
  return {1, n}
else
  return {0, count}
end
`;

const HOUR_COUNTER_TTL_SECONDS = 7200;

export type ReserveResult =
  | { allowed: true; slotMs: number; window: string }
  | { allowed: false; reason: "HOURLY_LIMIT"; retryAtMs: number; window: string };

// Quota is checked before the slot pointer advances, so a denial never
// pushes the sender's schedule forward. Ordering is best-effort.
export const reserveSendSlot = async (
  senderId: string,
  requestedTimeMs: number = Date.now()
): Promise<ReserveResult> => {
  const minDelayMs = Math.max(0, env.MIN_DELAY_MS);
  if (env.MAX_EMAILS_PER_HOUR < 1)
    throw new Error("MAX_EMAILS_PER_HOUR must be >= 1 (0 would reschedule forever)");

  const now = Date.now();
  const window = hourWindowFor(Math.max(now, requestedTimeMs));
  const used = Number((await client.get(hourCounterKey(senderId, window))) ?? "0");
  if (used >= env.MAX_EMAILS_PER_HOUR)
    return { allowed: false, reason: "HOURLY_LIMIT", retryAtMs: nextHourStartMs(now), window };

  const slotMs = Number(
    await client.eval(SLOT_SCRIPT, 1, nextSendKey(senderId), String(now), String(requestedTimeMs), String(minDelayMs))
  );

  const [allowed] = (await client.eval(
    QUOTA_SCRIPT,
    1,
    hourCounterKey(senderId, window),
    String(env.MAX_EMAILS_PER_HOUR),
    String(HOUR_COUNTER_TTL_SECONDS)
  )) as [number, number];

  if (allowed === 1) return { allowed: true, slotMs, window };
  return { allowed: false, reason: "HOURLY_LIMIT", retryAtMs: nextHourStartMs(now), window };
};
