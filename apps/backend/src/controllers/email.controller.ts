import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { prisma } from "../db/prisma.js";
import { scheduleEmail, listSenders, createSender, deleteSender, listEmails, getEmail, unscheduleEmail, updateScheduledEmail } from "../services/email.service.js";
import { searchEmails } from "../services/search.service.js";
import { zod400 } from "./auth.controller.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

export const scheduleHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json(await scheduleEmail(req.body, (req as AuthenticatedRequest).user.id));
  } catch (e) {
    if (e instanceof ZodError) return next(zod400(e));
    next(e);
  }
};

export const searchHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Ownership is resolved from PostgreSQL (authoritative), never from ES
    // and never from a client-supplied senderId.
    const senders = await prisma.sender.findMany({
      where: { userId: (req as AuthenticatedRequest).user.id },
      select: { id: true },
    });
    res.json(
      await searchEmails({
        q: req.query.q,
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
        senderIds: senders.map((s) => s.id),
      })
    );
  } catch (e) {
    next(e);
  }
};

export const listSendersHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ senders: await listSenders((req as AuthenticatedRequest).user.id) });
  } catch (e) {
    next(e);
  }
};

export const createSenderHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(201).json({ sender: await createSender((req as AuthenticatedRequest).user.id, req.body) });
  } catch (e) {
    if (e instanceof ZodError) return next(zod400(e));
    next(e);
  }
};

export const deleteSenderHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await deleteSender((req as AuthenticatedRequest).user.id, req.params.senderId));
  } catch (e) {
    next(e);
  }
};

export const deleteEmailHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await unscheduleEmail((req as AuthenticatedRequest).user.id, req.params.emailId));
  } catch (e) {
    next(e);
  }
};

export const getEmailHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ email: await getEmail((req as AuthenticatedRequest).user.id, req.params.emailId) });
  } catch (e) {
    next(e);
  }
};

export const patchEmailHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(
      await updateScheduledEmail(
        (req as AuthenticatedRequest).user.id,
        req.params.emailId,
        req.body
      )
    );
  } catch (e) {
    if (e instanceof ZodError) return next(zod400(e));
    next(e);
  }
};

export const listEmailsHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(
      await listEmails((req as AuthenticatedRequest).user.id, {
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  } catch (e) {
    next(e);
  }
};
