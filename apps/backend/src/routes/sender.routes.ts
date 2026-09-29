import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { listSendersHandler, createSenderHandler, deleteSenderHandler } from "../controllers/email.controller.js";

export const senderRouter = Router();
senderRouter.use(requireAuth);
senderRouter.get("/", listSendersHandler);
senderRouter.post("/", createSenderHandler);
senderRouter.delete("/:senderId", deleteSenderHandler);
