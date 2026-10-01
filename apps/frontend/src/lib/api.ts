// Centralized typed API client. Every backend call goes through here —
// no raw fetch calls scattered across components.
import type { EmailItem, EmailListResponse, SchedulePayload, Sender, User } from "../types/index";

export const TOKEN_KEY = "reachinbox_token";

// Same-origin by default: next.config.mjs rewrites /api/* to the backend.
// ponytail: always relative, one backend. No absolute URLs, no CORS split.
export const apiBase = () => "";

export const googleLoginUrl = () => `/api/auth/google`;

export const getToken = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string) => window.localStorage.setItem(TOKEN_KEY, token);

export const clearToken = () => window.localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const parseError = async (res: Response): Promise<string> => {
  try {
    const body = await res.json();
    for (const k of ["error", "message", "detail"] as const) {
      if (typeof body?.[k] === "string" && body[k]) return body[k];
    }
    if (Array.isArray(body?.errors) && typeof body.errors[0] === "string") return body.errors[0];
  } catch {
    /* fall through to status text */
  }
  return res.statusText || `request failed (${res.status})`;
};

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = getToken();
  // Bounded requests: a hung connection (e.g. backend restarting mid-call)
  // must fail loudly instead of spinning forever — the login callback hit this.
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (e) {
    throw new Error(e instanceof DOMException && e.name === "TimeoutError" ? "request timed out" : "network error");
  }
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  // 204 / empty bodies (logout-style) resolve as undefined.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, "unexpected response from server");
  }
};

export const fetchMe = () => apiFetch<{ user: User }>("/api/auth/me");

export const signupWithPassword = (email: string, password: string, name?: string) =>
  apiFetch<{ token: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
  });

export const loginWithPassword = (email: string, password: string) =>
  apiFetch<{ token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logout = async () => {
  try {
    await apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  } finally {
    clearToken();
  }
};

export const fetchSenders = () => apiFetch<{ senders: Sender[] }>("/api/senders");

export const createSender = (email: string) =>
  apiFetch<{ sender: Sender }>("/api/senders", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const deleteSender = (senderId: string) =>
  apiFetch<{ id: string }>(`/api/senders/${senderId}`, { method: "DELETE" });

export const fetchSlackStatus = () => apiFetch<{ connected: boolean }>("/api/slack/status");

export const disconnectSlack = () =>
  apiFetch<{ ok: boolean }>("/api/slack/disconnect", { method: "POST" });

// The connect endpoint answers 302 to Slack; the backend also exposes the
// same authorization URL as JSON on /api/slack/connect-url (a plain browser
// navigation carries no JWT, and fetch redirect:"manual" yields an
// unreadable opaqueredirect) — fetch it with auth, then navigate.
export const slackConnectUrl = async (): Promise<string> => {
  const { url } = await apiFetch<{ url: string }>("/api/slack/connect-url");
  if (!url) throw new Error("failed to start Slack connect");
  return url;
};

export const fetchEmails = (params: { status?: string; page?: number; limit?: number }) => {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 20));
  return apiFetch<EmailListResponse>(`/api/emails?${q.toString()}`);
};

export const searchEmails = (params: { q: string; status?: string; page?: number; limit?: number }) => {
  const q = new URLSearchParams({ q: params.q });
  if (params.status) q.set("status", params.status);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 20));
  return apiFetch<{ results: EmailListResponse["results"]; total: number }>(
    `/api/emails/search?${q.toString()}`
  );
};

export const scheduleEmail = (payload: SchedulePayload) =>
  apiFetch<{ emailId: string; jobId: string; status: string }>("/api/emails/schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const fetchEmail = (emailId: string) =>
  apiFetch<{ email: EmailItem }>(`/api/emails/${emailId}`);

export const unscheduleEmail = (emailId: string) =>
  apiFetch<{ id: string }>(`/api/emails/${emailId}`, { method: "DELETE" });

export const updateScheduledEmail = (emailId: string, payload: Partial<SchedulePayload>) =>
  apiFetch<{ emailId: string; jobId: string; status: string }>(`/api/emails/${emailId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
