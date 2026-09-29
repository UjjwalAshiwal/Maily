import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  googleHandler,
  googleCallbackHandler,
  meHandler,
  logoutHandler,
  signupHandler,
  loginHandler,
} from "../controllers/auth.controller.js";

export const authRouter = Router();
authRouter.get("/google", googleHandler);
authRouter.get("/google/callback", googleCallbackHandler);
authRouter.post("/signup", signupHandler);
authRouter.post("/login", loginHandler);
authRouter.get("/me", requireAuth, meHandler);
authRouter.post("/logout", logoutHandler);
