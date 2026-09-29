import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue, EMAIL_QUEUE_NAME } from "./email.queue.js";

// Development-only dashboard: no login. Mounted only when
// BULL_BOARD_ENABLED (see server.ts); otherwise /admin/queues 404s.
export const BULL_BOARD_QUEUE_NAME = EMAIL_QUEUE_NAME;

export const bullBoardAdapter = new BullMQAdapter(
  // Newer bullmq v5 Job types drifted from what board 5.x declares;
  // same runtime object, cast only at this dev-only boundary.
  emailQueue as unknown as never
);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({ queues: [bullBoardAdapter as never], serverAdapter });

export const bullBoardRouter = serverAdapter.getRouter() as unknown as Router;
