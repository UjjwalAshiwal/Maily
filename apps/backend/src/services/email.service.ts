import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { emailQueue } from "../queue/email.queue.js";
import { removeEmailFromIndex, syncEmailToIndex, EMAIL_STATUSES } from "./search.service.js";
import { clearEmailSlot } from "./rate-limit.service.js";
import { logger } from "../utils/logger.js";

const scheduleSchema = z.object({
  senderId: z.string().min(1),
  recipient: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledAt: z
    .string()
    .datetime()
    .refine((s) => new Date(s).getTime() > Date.now(), "scheduledAt must be in the future"),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const ADD_TIMEOUT_MS = env.QUEUE_ADD_TIMEOUT_MS;

const addWithTimeout = (
  data: { emailId: string },
  opts: { delay: number; jobId: string }
): Promise<{ id?: string }> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("queue unavailable (Redis timeout)")), ADD_TIMEOUT_MS);
  });
  return Promise.race([emailQueue.add("send-email", data, opts), timeout]).finally(() =>
    clearTimeout(timer)
  );
};

export const scheduleEmail = async (input: unknown, authUserId: string) => {
  const data = scheduleSchema.parse(input);

  const sender = await prisma.sender.findFirst({ where: { id: data.senderId, deletedAt: null } });
  // 404 either way: never reveal whether another user's sender exists.
  if (!sender || sender.userId !== authUserId)
    throw Object.assign(new Error("sender not found"), { status: 404 });

  let email;
  try {
    email = await prisma.email.create({
      data: {
        senderId: data.senderId,
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        scheduledAt: new Date(data.scheduledAt),
        idempotencyKey: data.idempotencyKey ?? randomUUID(),
      },
    });
  } catch (e: any) {
    // A replayed client-supplied key returns the original row.
    if (e?.code === "P2002" && data.idempotencyKey) {
      const existing = await prisma.email.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (existing) return { emailId: existing.id, jobId: existing.bullJobId ?? "", status: existing.status };
    }
    throw e;
  }

  try {
    const delay = Math.max(0, email.scheduledAt.getTime() - Date.now());
    // BullMQ buffers commands while Redis is unreachable (offline queue),
    // which would hang the request instead of failing. Bound the wait: on
    // timeout the existing catch marks the email FAILED (never orphaned
    // SCHEDULED) and returns 502. Fail-closed is safe: a late add() that
    // lands after the timeout finds a non-SCHEDULED email, which the worker
    // skips without sending.
    const job = await addWithTimeout(
      { emailId: email.id },
      { delay, jobId: `email-${email.id}` }
    );
    const updated = await prisma.email.update({
      where: { id: email.id },
      data: { bullJobId: job.id },
    });
    // Best-effort: scheduling never fails just because the index is down.
    await syncEmailToIndex(email.id);
    return { emailId: updated.id, jobId: job.id, status: updated.status };
  } catch (e: any) {
    // Never leave an orphaned SCHEDULED email behind.
    logger.error({ emailId: email.id, err: e }, "enqueue failed, marking email FAILED");
    await prisma.email
      .update({
        where: { id: email.id },
        data: { status: "FAILED", errorMessage: `enqueue failed: ${e.message ?? e}` },
      })
      .catch(() => {});
    await syncEmailToIndex(email.id);
    throw Object.assign(new Error("failed to enqueue email job"), { status: 502 });
  }
};

// Ownership resolved from PostgreSQL, never from the client. 404 either
// way: never reveal whether another user's email exists.
const loadOwnedEmail = async (authUserId: string, emailId: string) => {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: { select: { userId: true, email: true } } },
  });
  if (!email || email.sender.userId !== authUserId)
    throw Object.assign(new Error("email not found"), { status: 404 });
  return email;
};

// Single row→list-item mapper shared by the list and detail reads.
// errorMessage/failedAt/attempts are included so a FAILED row explains
// itself (SMTP reason) without needing Render logs or Bull Board access.
const toListItem = (e: {
  id: string;
  senderId: string;
  sender: { email: string };
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt: Date | null;
  errorMessage: string | null;
  failedAt: Date | null;
  attempts: number;
}) => ({
  id: e.id,
  senderId: e.senderId,
  senderEmail: e.sender.email,
  recipient: e.recipient,
  subject: e.subject,
  body: e.body,
  status: e.status,
  scheduledAt: e.scheduledAt.toISOString(),
  sentAt: e.sentAt?.toISOString() ?? null,
  errorMessage: e.errorMessage,
  failedAt: e.failedAt?.toISOString() ?? null,
  attempts: e.attempts,
});

// Single email for the detail view. Same ownership rule as everything else.
export const getEmail = async (authUserId: string, emailId: string) => {
  const email = await loadOwnedEmail(authUserId, emailId);
  return toListItem(email);
};

// --- Scheduled-email management (unschedule / edit) ---

const SCHEDULED_ONLY = "Only SCHEDULED emails can be modified.";

// BullMQ removal is safe for missing jobs (resolves falsy, never throws
// for absent jobs). Only a Redis failure rejects — callers fail closed so
// the record and the job never silently diverge.
const removeDelayedJob = (email: { id: string; bullJobId: string | null }) =>
  emailQueue.remove(email.bullJobId ?? `email-${email.id}`);

export const unscheduleEmail = async (authUserId: string, emailId: string) => {
  const email = await loadOwnedEmail(authUserId, emailId);
  if (email.status !== "SCHEDULED")
    throw Object.assign(new Error(SCHEDULED_ONLY), { status: 409 });
  try {
    await removeDelayedJob(email);
  } catch (e: any) {
    throw Object.assign(new Error("failed to remove email job"), { status: 502 });
  }
  // Conditional on SCHEDULED: a worker that flipped the row to PROCESSING
  // in the meantime wins, and this becomes a 409 instead of deleting mail
  // that is being sent.
  const removed = await prisma.email.deleteMany({ where: { id: emailId, status: "SCHEDULED" } });
  if (removed.count === 0) throw Object.assign(new Error(SCHEDULED_ONLY), { status: 409 });
  await clearEmailSlot(emailId).catch(() => {});
  await removeEmailFromIndex(emailId);
  return { id: emailId };
};

const patchSchema = z
  .object({
    senderId: z.string().min(1).optional(),
    recipient: z.string().email().optional(),
    subject: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    scheduledAt: z
      .string()
      .datetime()
      .refine((s) => new Date(s).getTime() > Date.now(), "scheduledAt must be in the future")
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "nothing to update");

export const updateScheduledEmail = async (authUserId: string, emailId: string, input: unknown) => {
  const data = patchSchema.parse(input);
  const email = await loadOwnedEmail(authUserId, emailId);
  if (email.status !== "SCHEDULED")
    throw Object.assign(new Error(SCHEDULED_ONLY), { status: 409 });
  if (data.senderId) {
    const sender = await prisma.sender.findFirst({ where: { id: data.senderId, deletedAt: null } });
    if (!sender || sender.userId !== authUserId)
      throw Object.assign(new Error("sender not found"), { status: 404 });
  }
  const updateData = {
    ...(data.senderId ? { senderId: data.senderId } : {}),
    ...(data.recipient ? { recipient: data.recipient } : {}),
    ...(data.subject ? { subject: data.subject } : {}),
    ...(data.body ? { body: data.body } : {}),
    ...(data.scheduledAt ? { scheduledAt: new Date(data.scheduledAt) } : {}),
  };
  const updated = await prisma.email.updateMany({
    where: { id: emailId, status: "SCHEDULED" },
    data: updateData,
  });
  if (updated.count === 0) throw Object.assign(new Error(SCHEDULED_ONLY), { status: 409 });
  // Re-enqueue the SAME email under the stable job id (remove-then-add).
  // The slot is cleared so the moved email reserves fresh — same semantics
  // as a newly scheduled email, same worker/rate-limit/ES behavior.
  try {
    await removeDelayedJob(email);
  } catch (e: any) {
    throw Object.assign(new Error("failed to remove email job"), { status: 502 });
  }
  await clearEmailSlot(emailId).catch(() => {});
  try {
    const fresh = await prisma.email.findUniqueOrThrow({ where: { id: emailId } });
    const delay = Math.max(0, fresh.scheduledAt.getTime() - Date.now());
    const job = await addWithTimeout({ emailId }, { delay, jobId: `email-${emailId}` });
    await prisma.email.update({ where: { id: emailId }, data: { bullJobId: job.id } });
    await syncEmailToIndex(emailId);
    return { emailId, jobId: job.id, status: fresh.status };
  } catch (e: any) {
    logger.error({ emailId, err: e }, "re-enqueue failed, marking email FAILED");
    await prisma.email
      .update({
        where: { id: emailId },
        data: { status: "FAILED", errorMessage: `re-enqueue failed: ${e.message ?? e}` },
      })
      .catch(() => {});
    await syncEmailToIndex(emailId);
    throw Object.assign(new Error("failed to re-enqueue email job"), { status: 502 });
  }
};

// Read models (PostgreSQL-authoritative, for dashboard lists).

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

// Pure param parsing so the rules are unit-testable without a database.
export const parseListParams = (input: { status?: unknown; page?: unknown; limit?: unknown }) => {
  const status =
    input.status === undefined || input.status === ""
      ? undefined
      : typeof input.status === "string" &&
          (EMAIL_STATUSES as readonly string[]).includes(input.status)
        ? input.status
        : (() => {
            throw Object.assign(new Error("invalid status filter"), { status: 400 });
          })();
  return {
    status,
    page: Math.max(1, Number(input.page) || 1),
    limit: Math.min(MAX_LIST_LIMIT, Math.max(1, Number(input.limit) || DEFAULT_LIST_LIMIT)),
  };
};

// Senders belonging to the caller — the only valid senderIds for scheduling.
// Soft-deleted senders stay hidden here; their emails remain visible.
export const listSenders = (authUserId: string) =>
  prisma.sender.findMany({
    where: { userId: authUserId, deletedAt: null },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

const createSenderSchema = z.object({ email: z.string().email() });

// Sender creation: email address only, always owned by the caller. No SMTP
// credentials — sending still uses the shared Ethereal configuration.
export const createSender = async (authUserId: string, input: unknown) => {
  const data = createSenderSchema.parse(input);
  try {
    return await prisma.sender.create({
      data: { userId: authUserId, email: data.email },
      select: { id: true, email: true },
    });
  } catch (e: any) {
    if (e?.code === "P2002") throw Object.assign(new Error("sender already exists"), { status: 409 });
    throw e;
  }
};

// Sender deletion is a soft delete: the row (and every email, job, and
// index doc) is preserved, so history never disappears. Only live mail
// blocks removal — a SCHEDULED email still needs its sender for quota and
// sending, and a PROCESSING one is mid-send.
export const deleteSender = async (authUserId: string, senderId: string) => {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender || sender.userId !== authUserId || sender.deletedAt)
    throw Object.assign(new Error("sender not found"), { status: 404 });
  const live = await prisma.email.count({
    where: { senderId, status: { in: ["SCHEDULED", "PROCESSING"] } },
  });
  if (live > 0)
    throw Object.assign(new Error("Cannot delete sender with scheduled emails."), {
      status: 409,
    });
  await prisma.sender.update({ where: { id: senderId }, data: { deletedAt: new Date() } });
  return { id: senderId };
};

// Paginated email list scoped to the caller's senders via the relation
// (no client-supplied senderId, no Elasticsearch — PG is authoritative).
export const listEmails = async (
  authUserId: string,
  input: { status?: unknown; page?: unknown; limit?: unknown }
) => {
  const { status, page, limit } = parseListParams(input);
  const where = { sender: { userId: authUserId }, ...(status ? { status: status as never } : {}) };
  const [total, emails] = await Promise.all([
    prisma.email.count({ where }),
    prisma.email.findMany({
      where,
      select: {
        id: true,
        senderId: true,
        recipient: true,
        subject: true,
        body: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        errorMessage: true,
        failedAt: true,
        attempts: true,
        sender: { select: { email: true } },
      },
      orderBy: { scheduledAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return {
    results: emails.map(toListItem),
    total,
    page,
    limit,
  };
};
