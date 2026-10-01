import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// BullMQ needs maxRetriesPerRequest: null (blocking commands).
// One instance per Queue/Worker; /health uses its own client.
export const createQueueConnection = () => {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  conn.on("error", (err) => logger.error({ err }, "queue redis error"));
  return conn;
};
