import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  connectHandler,
  connectUrlHandler,
  callbackHandler,
  statusHandler,
  disconnectHandler,
} from "../controllers/slack.controller.js";

export const slackRouter = Router();
slackRouter.get("/connect", requireAuth, connectHandler);
slackRouter.get("/connect-url", requireAuth, connectUrlHandler);
// Public: Slack redirects here without our JWT; one-time state authenticates.
slackRouter.get("/callback", callbackHandler);
slackRouter.get("/status", requireAuth, statusHandler);
slackRouter.post("/disconnect", requireAuth, disconnectHandler);
