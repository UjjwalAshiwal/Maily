import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger.js";
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err);
  if (err instanceof ZodError)
    return res.status(400).json({ error: `invalid request: ${err.issues[0]?.message}` });
  const status = typeof err?.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  // Never leak Prisma/SMTP internals on 500s.
  const message = status === 500 ? "internal error" : String(err?.message || "internal error").slice(0, 200);
  res.status(status).json({ error: message });
};
