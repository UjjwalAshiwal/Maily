import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { emailRouter } from "./routes/email.routes.js";
import { senderRouter } from "./routes/sender.routes.js";
import { slackRouter } from "./routes/slack.routes.js";
import { bullBoardRouter } from "./queue/bull-board.js";
import { errorHandler } from "./middleware/error.middleware.js";
import "./queue/email.worker.js";

const app = express();
app.use(cors({ origin: env.FRONTEND_URL }));
app.use(express.json());

app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/emails", emailRouter);
app.use("/api/senders", senderRouter);
app.use("/api/slack", slackRouter);
if (env.BULL_BOARD_ENABLED) app.use("/admin/queues", bullBoardRouter);
else app.use("/admin/queues", (_req, res) => res.status(404).json({ error: "not found" }));

app.use(errorHandler);

app.listen(env.PORT, () => logger.info(`backend listening on :${env.PORT}`));
