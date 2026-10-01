import { Worker, DelayedError, UnrecoverableError } from "bullmq";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../db/prisma.js";
import { sendEmail } from "../integrations/ethereal.js";
import { syncEmailToIndex } from "../services/search.service.js";
import { notifyHourlyLimit } from "../services/slack.service.js";
import { reserveSendSlot, getEmailSlot, setEmailSlot, clearEmailSlot } from "../services/rate-limit.service.js";
import { isProcessingRecovery } from "./processing-recovery.js";
import { createQueueConnection } from "./connection.js";
import { EMAIL_QUEUE_NAME } from "./email.queue.js";

// Phase 4: SCHEDULED emails first reserve a Redis send slot. Not sendable
// yet -> the SAME job is moved to a future delayed execution (no duplicate
// jobs, no failure recorded, Email stays SCHEDULED). Only a sendable email
// becomes PROCESSING. SMTP behavior below is unchanged from Phase 3C.
export const emailWorker = new Worker(
  EMAIL_QUEUE_NAME,
  async (job) => {
    const { emailId } = job.data as { emailId?: string };
    if (!emailId) throw new Error("job payload missing emailId");

    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: { sender: { select: { email: true } } },
    });
    if (!email) throw new Error(`email ${emailId} not found`);

    if (email.status === "SENT") {
      logger.info({ emailId, jobId: job.id }, "email already sent, skipping");
      return;
    }
    if (email.status === "FAILED") {
      logger.info({ emailId, jobId: job.id }, "email already failed, skipping");
      return;
    }
    // Crash recovery: PROCESSING with no terminal write means a previous
    // attempt died mid-send; a BullMQ retry/stall-recovery of the same job
    // must reprocess (falls through to the stored-slot + send flow below).
    // Anything else non-SCHEDULED keeps the old skip.
    if (email.status === "PROCESSING") {
      if (!isProcessingRecovery(job)) {
        logger.info({ emailId, jobId: job.id, status: email.status }, "email not scheduled, skipping");
        return;
      }
      logger.info(
        { emailId, jobId: job.id, attemptsMade: job.attemptsMade, stalledCounter: job.stalledCounter },
        "recovering PROCESSING email after retry/crash"
      );
    } else if (email.status !== "SCHEDULED") {
      logger.info({ emailId, jobId: job.id, status: email.status }, "email not scheduled, skipping");
      return;
    }

    // Reserve once per email, then wait without re-consuming. Re-reserving on
    // every wake never converges (each wake allocates max(now,next)+delay, so
    // the slot is always in the future) and pushes the shared pointer forward.
    // The stored slot survives retries: a retry reuses it instead of taking
    // a new one. Quota was consumed at reservation time.
    let slotMs = await getEmailSlot(email.id);
    if (slotMs === null) {
      const decision = await reserveSendSlot(email.senderId, email.scheduledAt.getTime());
      if (!decision.allowed) {
        // Best-effort Slack notification. Never throws: the reschedule below
        // runs unconditionally, and the Email is never FAILED for Slack reasons.
        await notifyHourlyLimit({
          senderId: email.senderId,
          senderEmail: email.sender.email,
          limit: env.MAX_EMAILS_PER_HOUR,
          window: decision.window,
          retryAtMs: decision.retryAtMs,
          emailId,
          jobId: job.id,
        });
        try {
          await job.moveToDelayed(decision.retryAtMs);
        } catch {
          await job.moveToDelayed(Date.now() + 60_000);
        }
        logger.info(
          {
            emailId,
            senderId: email.senderId,
            jobId: job.id,
            decision: "RESCHEDULED",
            reason: decision.reason,
            scheduledFor: new Date(decision.retryAtMs).toISOString(),
            window: decision.window,
          },
          "rate limit reached, rescheduled"
        );
        // The job is now delayed, not complete: DelayedError tells BullMQ to
        // skip the completed/failed transition (no retry consumed, no failure).
        // A bare return here breaks at runtime ("not in the active state").
        throw new DelayedError();
      }
      slotMs = decision.slotMs;
      await setEmailSlot(email.id, slotMs);
    }
    if (slotMs > Date.now()) {
      try {
        await job.moveToDelayed(slotMs);
      } catch {
        await job.moveToDelayed(Date.now() + 60_000);
      }
      logger.info(
        {
          emailId,
          senderId: email.senderId,
          jobId: job.id,
          decision: "RESCHEDULED",
          reason: "MIN_DELAY",
          scheduledFor: new Date(slotMs).toISOString(),
        },
        "minimum delay not met, rescheduled"
      );
      throw new DelayedError();
    }

    // Atomic claim: only the worker that flips SCHEDULED->PROCESSING sends.
    const claimed = await prisma.email.updateMany({
      where: { id: emailId, status: "SCHEDULED" },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    if (claimed.count === 0 && email.status === "SCHEDULED") {
      logger.info({ emailId, jobId: job.id }, "lost SCHEDULED claim race, skipping");
      return;
    }
    if (email.status === "PROCESSING") {
      await prisma.email.update({ where: { id: emailId }, data: { attempts: { increment: 1 } } }).catch(() => {});
    }
    // Best-effort index sync. Never throws: ES failure must not resend email.
    await syncEmailToIndex(emailId);

    try {
      const { previewUrl } = await sendEmail({
        to: email.recipient,
        subject: email.subject,
        body: email.body,
      });
      await prisma.email.update({
        where: { id: emailId },
        data: { status: "SENT", sentAt: new Date(), failedAt: null, errorMessage: null },
      });
      await clearEmailSlot(emailId).catch(() => {});
      await syncEmailToIndex(emailId);
      logger.info({ emailId, recipient: email.recipient, jobId: job.id, previewUrl }, "email sent");
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      // ponytail: fail fast on config/auth errors, retry only on transient SMTP
      if (/auth|credential|certificate|ENCRYPTION_KEY|configuration/i.test(msg))
        throw new UnrecoverableError(msg);
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await prisma.email
          .update({
            where: { id: emailId },
            data: { status: "FAILED", failedAt: new Date(), errorMessage: err.message ?? String(err) },
          })
          .catch(() => {});
        await clearEmailSlot(emailId).catch(() => {});
        await syncEmailToIndex(emailId);
        logger.error({ emailId, jobId: job.id, err }, "email failed permanently");
      } else {
        logger.error(
          { emailId, jobId: job.id, attempt: job.attemptsMade + 1, err },
          "email send failed, retrying"
        );
      }
      throw err;
    }
  },
  { connection: createQueueConnection(), concurrency: env.WORKER_CONCURRENCY }
);

emailWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "email-send job failed");
});
emailWorker.on("error", (err) => {
  logger.error({ err }, "email-send worker error");
});
