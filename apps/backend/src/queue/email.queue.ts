import { Queue } from "bullmq";
import { createQueueConnection } from "./connection.js";

export const EMAIL_QUEUE_NAME = "email-send";

// Delayed jobs are a per-job option ({ delay }), so the queue itself
// needs no delay config — it just has to exist and survive restarts (Redis AOF).
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: createQueueConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  },
});
