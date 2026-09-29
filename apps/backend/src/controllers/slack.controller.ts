import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { buildSlackAuthUrl } from "../integrations/slack.js";
import {
  newSlackOAuthState,
  consumeSlackOAuthState,
  connectSlack,
  disconnectSlack,
  getSlackStatus,
} from "../services/slack.service.js";

export const connectHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthenticatedRequest).user.id;
    res.redirect(await slackAuthUrlFor(userId));
  } catch (e) {
    next(e);
  }
};

// Single authorization-URL builder for both entry points (302 + JSON):
// one PKCE attempt per call, same user-bound state, no second flow.
const slackAuthUrlFor = async (userId: string): Promise<string> => {
  const { state, codeChallenge } = await newSlackOAuthState(userId);
  return buildSlackAuthUrl(state, codeChallenge);
};

// Same authorization URL as connectHandler, but returned as JSON: browsers
// navigating directly cannot send the JWT Authorization header, and a
// fetch with redirect:"manual" yields an opaqueredirect whose Location is
// unreadable — so the frontend fetches the URL with auth, then navigates.
export const connectUrlHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthenticatedRequest).user.id;
    res.json({ url: await slackAuthUrlFor(userId) });
  } catch (e) {
    next(e);
  }
};

const slackFailed = (res: Response) => res.redirect(`${env.FRONTEND_URL}/dashboard/settings?slack=error`);

// Public endpoint (Slack redirects here without our JWT); the consumed
// OAuth state is what authenticates the user.
export const callbackHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    const stored = state ? await consumeSlackOAuthState(state).catch(() => null) : null;
    if (!code || !stored) {
      logger.warn("slack callback with missing/invalid state");
      return slackFailed(res);
    }
    await connectSlack(stored.userId, code, stored.codeVerifier);
    res.redirect(`${env.FRONTEND_URL}/dashboard/settings?slack=connected`);
  } catch (e) {
    logger.error({ err: e }, "slack callback failed");
    if (!res.headersSent) return slackFailed(res);
    next(e);
  }
};

export const statusHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getSlackStatus((req as AuthenticatedRequest).user.id));
  } catch (e) {
    next(e);
  }
};

export const disconnectHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await disconnectSlack((req as AuthenticatedRequest).user.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};
