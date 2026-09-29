import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err);
  // Empty-string messages (e.g. ES client outages) fall back too — never
  // leak an empty or internal-shaped body to clients.
  res.status(err.status ?? 500).json({ error: err.message || "internal error" });
};
