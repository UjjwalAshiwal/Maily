import type { Request, Response, NextFunction } from "express";
import { ZodError, z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  buildGoogleAuthUrl,
  newOAuthState,
  consumeOAuthState,
  exchangeCodeForProfile,
  findOrCreateUser,
  loginWithPassword,
  signToken,
  signupWithPassword,
} from "../services/auth.service.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

export const googleHandler = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.redirect(buildGoogleAuthUrl(await newOAuthState()));
  } catch (e) {
    next(e);
  }
};

const oauthFailed = (res: Response) => res.redirect(`${env.FRONTEND_URL}/login?error=oauth_failed`);

export const googleCallbackHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || !(await consumeOAuthState(state))) {
      logger.warn("oauth callback with missing/invalid state");
      return oauthFailed(res);
    }
    const user = await findOrCreateUser(await exchangeCodeForProfile(code));
    // Token goes to our own frontend via query param (documented trade-off);
    // never log it, never return provider tokens.
    res.redirect(`${env.FRONTEND_URL}/auth/callback?token=${signToken(user.id)}`);
  } catch (e) {
    logger.error({ err: e }, "oauth callback failed");
    if (!res.headersSent) return oauthFailed(res);
    next(e);
  }
};

export const meHandler = (req: Request, res: Response) => {
  res.json({ user: (req as AuthenticatedRequest).user });
};

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const zod400 = (e: ZodError) =>
  Object.assign(new Error(`invalid request: ${e.issues[0]?.message}`), { status: 400 });

export const signupHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await signupWithPassword(signupSchema.parse(req.body));
    res.status(201).json({ token: signToken(user.id) });
  } catch (e) {
    if (e instanceof ZodError) return next(zod400(e));
    next(e);
  }
};

export const loginHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await loginWithPassword(loginSchema.parse(req.body));
    res.json({ token: signToken(user.id) });
  } catch (e) {
    if (e instanceof ZodError) return next(zod400(e));
    next(e);
  }
};

// Stateless JWT: nothing to invalidate server-side. The client discards the
// token; it expires on its own (7 days).
export const logoutHandler = (_req: Request, res: Response) => {
  res.json({ ok: true });
};
