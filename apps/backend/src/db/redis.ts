import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// Liveness-check client. BullMQ gets its own connections (see queue/connection.ts).
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});
redis.on("error", (err) => logger.error({ err }, "redis error"));
