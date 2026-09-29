import { Redis } from "ioredis";
import { env } from "../config/env.js";

// BullMQ needs maxRetriesPerRequest: null (blocking commands).
// One instance per Queue/Worker — never share the /health client in db/redis.ts.
export const createQueueConnection = () =>
  new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
