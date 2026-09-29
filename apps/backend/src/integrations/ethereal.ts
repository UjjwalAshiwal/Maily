import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | false;
}

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (transporter) return transporter;
  if (!env.ETHEREAL_USER || !env.ETHEREAL_PASSWORD)
    throw new Error("Ethereal SMTP credentials not configured (ETHEREAL_USER / ETHEREAL_PASSWORD)");
  transporter = nodemailer.createTransport({
    host: env.ETHEREAL_HOST,
    port: env.ETHEREAL_PORT,
    auth: { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASSWORD },
  });
  return transporter;
};

export const sendEmail = async (input: SendEmailInput): Promise<SendEmailResult> => {
  const info = await getTransporter().sendMail({
    from: env.ETHEREAL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) };
};
