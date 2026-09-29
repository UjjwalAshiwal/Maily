import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleLoginUrl, ApiError, apiFetch, scheduleEmail } from "./api";

// apiFetch is exercised with a stubbed global fetch — no backend needed.
// (In Node there is no window/localStorage, so getToken() is always null
// here; header behavior with a token is covered by code review, not this.)

const mockJson = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : status === 500 ? "Server Error" : "OK",
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  }) as Response;

const withFetch = (impl: (url: unknown, init?: RequestInit) => Promise<Response>) => {
  const prev = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = impl;
  return () => {
    (globalThis as Record<string, unknown>).fetch = prev;
  };
};

describe("login CTA", () => {
  it("googleLoginUrl points at the backend OAuth entry", () => {
    assert.ok(googleLoginUrl().endsWith("/api/auth/google"));
  });
});

describe("schedule API", () => {
  it("POSTs the schedule payload as JSON", async () => {
    let method = "";
    let payload: unknown;
    const restore = withFetch(async (_url, init) => {
      method = init?.method ?? "";
      payload = JSON.parse(String(init?.body));
      return mockJson(201, { emailId: "e", jobId: "email-e", status: "SCHEDULED" });
    });
    try {
      const res = await scheduleEmail({
        senderId: "s",
        recipient: "to@example.com",
        subject: "Hi",
        body: "Hello",
        scheduledAt: new Date().toISOString(),
      });
      assert.equal(method, "POST");
      assert.equal((payload as Record<string, unknown>).recipient, "to@example.com");
      assert.equal(res.emailId, "e");
    } finally {
      restore();
    }
  });
});

describe("apiFetch", () => {
  it("throws ApiError with the backend message on 401", async () => {
    const restore = withFetch(async () => mockJson(401, { error: "unauthorized" }));
    try {
      await assert.rejects(apiFetch("/api/auth/me"), (e: unknown) => {
        return e instanceof ApiError && e.status === 401 && e.message === "unauthorized";
      });
    } finally {
      restore();
    }
  });

  it("falls back to status text on 500 with no body", async () => {
    const restore = withFetch(async () => mockJson(500, undefined));
    try {
      await assert.rejects(apiFetch("/api/emails"), (e: unknown) => {
        return e instanceof ApiError && e.status === 500;
      });
    } finally {
      restore();
    }
  });

  it("resolves undefined for empty bodies", async () => {
    const restore = withFetch(async () => mockJson(200, undefined));
    try {
      const out = await apiFetch<undefined>("/api/auth/logout", { method: "POST" });
      assert.equal(out, undefined);
    } finally {
      restore();
    }
  });
});
