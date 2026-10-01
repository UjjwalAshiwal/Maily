import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { redis } from "../db/redis.js";
import { verifySmtp } from "../integrations/ethereal.js";
import { es } from "../integrations/elasticsearch.js";
import { logger } from "../utils/logger.js";

const withTimeout = <T>(p: Promise<T>, ms = 8000): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export const readyRouter = Router();

// Deep dependency check: postgres, redis, SMTP login, Elasticsearch.
// /health stays light for load balancers; /ready fails loudly so missing
// credentials show up here instead of as silent FAILED jobs.
readyRouter.get("/", async (_req, res) => {
  const status: Record<string, "up" | "down"> = { postgres: "down", redis: "down", smtp: "down", elasticsearch: "down" };
  const errors: Record<string, string> = {};
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`);
    status.postgres = "up";
  } catch (err: any) {
    errors.postgres = err?.message ?? String(err);
  }
  try {
    if ((await withTimeout(redis.ping())) === "PONG") status.redis = "up";
  } catch (err: any) {
    errors.redis = err?.message ?? String(err);
  }
  try {
    await withTimeout(verifySmtp());
    status.smtp = "up";
  } catch (err: any) {
    errors.smtp = err?.message ?? String(err);
  }
  try {
    await withTimeout(es.ping());
    status.elasticsearch = "up";
  } catch (err: any) {
    errors.elasticsearch = err?.message ?? String(err);
  }
  const ok = Object.values(status).every((s) => s === "up");
  if (!ok) logger.error({ status, errors }, "ready check failed");
  res.status(ok ? 200 : 503).json({ ok, ...status, ...(ok ? {} : { errors }) });
});
