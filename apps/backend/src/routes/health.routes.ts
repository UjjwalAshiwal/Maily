import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { redis } from "../db/redis.js";
import { logger } from "../utils/logger.js";

const withTimeout = <T>(p: Promise<T>, ms = 3000): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let postgres: "up" | "down" = "down";
  let redisStatus: "up" | "down" = "down";
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`);
    postgres = "up";
  } catch (err) {
    logger.error({ err }, "health: postgres down");
  }
  try {
    const pong = await withTimeout(redis.ping());
    if (pong === "PONG") redisStatus = "up";
  } catch (err) {
    logger.error({ err }, "health: redis down");
  }
  const ok = postgres === "up" && redisStatus === "up";
  res.status(ok ? 200 : 503).json({ ok, postgres, redis: redisStatus });
});
