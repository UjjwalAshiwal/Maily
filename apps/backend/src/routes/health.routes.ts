import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { redis } from "../db/redis.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let postgres: "up" | "down" = "down";
  let redisStatus: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    postgres = "up";
  } catch {
    /* stays down */
  }
  try {
    const pong = await redis.ping();
    if (pong === "PONG") redisStatus = "up";
  } catch {
    /* stays down */
  }
  const ok = postgres === "up" && redisStatus === "up";
  res.status(ok ? 200 : 503).json({ ok, postgres, redis: redisStatus });
});
