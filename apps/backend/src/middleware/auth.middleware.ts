import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { verifyToken } from "../services/auth.service.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

// Never trusts a client-supplied userId: identity comes only from the
// verified JWT, and the user row is reloaded from PostgreSQL per request.
export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return next(Object.assign(new Error("unauthorized"), { status: 401 }));

  const payload = verifyToken(token);
  if (!payload) return next(Object.assign(new Error("invalid or expired token"), { status: 401 }));

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return next(Object.assign(new Error("unauthorized"), { status: 401 }));
    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
    next();
  } catch (e) {
    next(e);
  }
};
