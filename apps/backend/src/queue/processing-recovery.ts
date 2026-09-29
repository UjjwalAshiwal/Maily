// PROCESSING-state crash recovery decision (pure: no Redis, no BullMQ import).
//
// A PROCESSING row with no terminal write means a previous attempt died
// between the PROCESSING update and the SENT/FAILED update. BullMQ replays
// the SAME stable job (jobId `email-<id>`) either as a retry
// (attemptsMade > 0, e.g. after an SMTP throw) or as a stall recovery
// (stalledCounter > 0: the lock expired while no worker was alive, e.g. a
// crash). Both are legitimate continuations of this email, so the worker
// must reprocess instead of skipping. A first delivery (0 attempts, never
// stalled) seeing PROCESSING is not a recovery — same-job concurrency is
// already prevented by BullMQ's lock — so it keeps the old skip behavior.
//
// Recovery reuses the stored reserve-once slot, so it never consumes hourly
// quota twice. No exactly-once claim: a crash between SMTP acceptance and
// the SENT write can still duplicate-send on recovery (pre-existing,
// documented window — same class as the retry path, not widened by this).
export interface RecoveryCandidate {
  attemptsMade: number;
  stalledCounter?: number | null;
}

export const isProcessingRecovery = (job: RecoveryCandidate): boolean =>
  job.attemptsMade > 0 || (job.stalledCounter ?? 0) > 0;
