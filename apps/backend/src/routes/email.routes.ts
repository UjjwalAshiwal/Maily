import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { scheduleHandler, searchHandler, listEmailsHandler, getEmailHandler, deleteEmailHandler, patchEmailHandler } from "../controllers/email.controller.js";

export const emailRouter = Router();
emailRouter.use(requireAuth);
emailRouter.get("/", listEmailsHandler);
emailRouter.get("/search", searchHandler);
emailRouter.post("/schedule", scheduleHandler);
emailRouter.get("/:emailId", getEmailHandler);
emailRouter.delete("/:emailId", deleteEmailHandler);
emailRouter.patch("/:emailId", patchEmailHandler);
