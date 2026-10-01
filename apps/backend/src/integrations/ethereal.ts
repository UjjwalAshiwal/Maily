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

// Render free tier blocks outbound SMTP (25/465/587), so SMTP always times
// out there. When RESEND_API_KEY is set, send over HTTPS instead — same
// interface, no new dependency (global fetch).
const useResend = (): boolean => env.RESEND_API_KEY !== "";

const sendViaResend = async (input: SendEmailInput): Promise<SendEmailResult> => {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: input.to,
      subject: input.subject,
      text: input.body,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { id?: string };
  // No preview inbox over HTTP: previewUrl stays false, messageId is enough.
  return { messageId: data.id ?? "", previewUrl: false };
};

const getTransporter = (): Transporter => {
  if (transporter) return transporter;
  if (!env.ETHEREAL_USER || !env.ETHEREAL_PASSWORD)
    throw new Error("Ethereal SMTP credentials not configured (ETHEREAL_USER / ETHEREAL_PASSWORD)");
  transporter = nodemailer.createTransport({
    host: env.ETHEREAL_HOST,
    port: env.ETHEREAL_PORT,
    auth: { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return transporter;
};

export const sendEmail = async (input: SendEmailInput): Promise<SendEmailResult> => {
  if (useResend()) return sendViaResend(input);
  const info = await getTransporter().sendMail({
    from: env.ETHEREAL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
  return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) };
};

// Loud dependency probe for /ready: verifies SMTP login without sending,
// or the Resend key when the HTTPS path is active.
export const verifySmtp = async (): Promise<void> => {
  if (useResend()) {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend verify failed (${res.status}): ${detail}`);
    }
    return;
  }
  await getTransporter().verify();
};
