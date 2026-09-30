import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Shared read-only client for liveness checks. BullMQ gets its own
// connections (see queue/connection.ts) — never share this one there.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});
redis.on("error", () => {});
