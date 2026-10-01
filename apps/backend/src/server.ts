import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { healthRouter } from "./routes/health.routes.js";
import { readyRouter } from "./routes/ready.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { emailRouter } from "./routes/email.routes.js";
import { senderRouter } from "./routes/sender.routes.js";
import { slackRouter } from "./routes/slack.routes.js";
import { bullBoardRouter } from "./queue/bull-board.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { prisma } from "./db/prisma.js";
import { redis } from "./db/redis.js";

const app = express();
const allowedOrigins = env.FRONTEND_URL.split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length <= 1 ? env.FRONTEND_URL : allowedOrigins }));
app.use(express.json({ limit: "256kb" }));

app.use("/health", healthRouter);
app.use("/ready", readyRouter);
app.use("/api/auth", authRouter);
app.use("/api/emails", emailRouter);
app.use("/api/senders", senderRouter);
app.use("/api/slack", slackRouter);
// Lazy import so tests never open Queue+Worker connections.
if (env.BULL_BOARD_ENABLED) app.use("/admin/queues", bullBoardRouter);
else app.use("/admin/queues", (_req, res) => res.status(404).json({ error: "not found" }));

if (process.env.NODE_ENV !== "test") await import("./queue/email.worker.js");

app.use(errorHandler);

const server = app.listen(env.PORT, () => logger.info(`backend listening on :${env.PORT}`));

const shutdown = async () => {
  server.close();
  try {
    const { emailWorker } = await import("./queue/email.worker.js");
    await emailWorker.close();
  } catch {}
  redis.disconnect();
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
