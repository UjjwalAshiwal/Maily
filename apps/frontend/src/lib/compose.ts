// Pure compose-form validation (backend remains authoritative; this is UX).

export interface ComposeInput {
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string; // datetime-local value
}

export type ComposeErrors = Partial<Record<keyof ComposeInput, string>>;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateCompose = (input: ComposeInput, now = Date.now()): ComposeErrors => {
  const errors: ComposeErrors = {};
  if (!input.senderId) errors.senderId = "Choose a sender.";
  if (!input.recipient.trim()) errors.recipient = "Recipient is required.";
  else if (!EMAIL_RE.test(input.recipient.trim()))
    errors.recipient = "Enter a valid email address.";
  if (!input.subject.trim()) errors.subject = "Subject is required.";
  if (!input.body.trim()) errors.body = "Body is required.";
  if (!input.scheduledAt) errors.scheduledAt = "Pick a start time.";
  else if (new Date(input.scheduledAt).getTime() <= now)
    errors.scheduledAt = "Start time must be in the future.";
  return errors;
};

// Default start time for the picker: 10 minutes out, formatted for datetime-local.
export const defaultStartTime = (now = Date.now()): string => {
  const d = new Date(now + 10 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ISO string → datetime-local input value (local timezone). Shared by the
// edit prefill (compose page ?edit=<id>).
export const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Recipient i sends at start, spaced by delayMs, at most hourlyLimit per
// UTC hour window (overflow spills to the next hour top). Pure: the compose
// page turns delay/hourly inputs into concrete scheduledAt values, so the
// backend scheduler architecture stays untouched.
export function computeSchedule(recipientCount: number, startMs: number, delayMs: number, hourlyLimit: number): number[] {
  const out: number[] = [];
  let t = startMs;
  let windowStart = Math.floor(t / 3_600_000) * 3_600_000;
  let used = 0;
  for (let i = 0; i < recipientCount; i++) {
    if (i > 0) t += Math.max(0, delayMs);
    windowStart = Math.floor(t / 3_600_000) * 3_600_000;
    if (used >= Math.max(1, hourlyLimit) && t < windowStart + 3_600_000) {
      t = windowStart + 3_600_000;
      windowStart = t;
      used = 0;
    } else if (t >= windowStart + 3_600_000) {
      windowStart = Math.floor(t / 3_600_000) * 3_600_000;
      used = 0;
    }
    used += 1;
    out.push(t);
  }
  return out;
}

export const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};
