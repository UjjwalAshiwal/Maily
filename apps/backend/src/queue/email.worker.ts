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

// Not sendable yet -> the same job moves to a delayed run, Email stays SCHEDULED.
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
    // A PROCESSING row with no terminal write means the previous attempt died
    // mid-send; retries/stall-recovery must reprocess it.
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

    // Each email reserves one slot and reuses it across retries.
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
        // DelayedError skips the completed/failed transition without consuming a retry.
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

    // Only the worker that flips SCHEDULED->PROCESSING sends.
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
    // Index sync never throws: ES failure must not resend email.
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
      // Config/auth errors never succeed on retry; transient SMTP does.
      // Fail the row here: UnrecoverableError skips all remaining retries,
      // so without this write the email would sit in PROCESSING forever
      // next to an already-failed job (exactly the "failed job, no outcome"
      // state seen on Render when SMTP creds are missing there).
      if (/auth|credential|certificate|ENCRYPTION_KEY|configuration/i.test(msg)) {
        await prisma.email
          .update({
            where: { id: emailId },
            data: { status: "FAILED", failedAt: new Date(), errorMessage: msg },
          })
          .catch(() => {});
        await clearEmailSlot(emailId).catch(() => {});
        await syncEmailToIndex(emailId);
        throw new UnrecoverableError(msg);
      }
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
