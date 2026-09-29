import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSlackAuthUrl, codeChallengeFor, newCodeVerifier } from "../integrations/slack.js";
import {
  notifyDedupeKey,
  notifyDedupeTtlSeconds,
  buildRateLimitMessage,
  notifyHourlyLimit,
} from "./slack.service.js";
import { env } from "../config/env.js";

// No live Slack/Redis/PG here. Provider exchange, connection CRUD, and the
// Redis dedupe race need Docker + real Slack credentials (env-blocked).

describe("buildSlackAuthUrl", () => {
  it("points at Slack with our client, bot webhook scope, callback, state, and PKCE challenge", () => {
    const url = new URL(buildSlackAuthUrl("state-xyz", "challenge-abc"));
    assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(url.searchParams.get("client_id"), env.SLACK_CLIENT_ID);
    assert.equal(url.searchParams.get("redirect_uri"), env.SLACK_REDIRECT_URI);
    // incoming-webhook is bot-only (no user-scope equivalent); localhost
    // therefore needs an https tunnel redirect, not a scope downgrade.
    assert.equal(url.searchParams.get("scope"), "incoming-webhook");
    assert.equal(url.searchParams.get("state"), "state-xyz");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-abc");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });
});

describe("PKCE", () => {
  it("verifier is random per attempt and challenge is the S256 of it", () => {
    assert.notEqual(newCodeVerifier(), newCodeVerifier());
    // RFC 7636 appendix B vector.
    assert.equal(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    assert.match(newCodeVerifier(), /^[A-Za-z0-9_-]+$/);
  });
});

describe("notifyDedupeKey", () => {
  it("isolates senders and hour windows", () => {
    assert.equal(notifyDedupeKey("a", "2026092915"), "slack:notified:a:2026092915");
    assert.notEqual(notifyDedupeKey("a", "2026092915"), notifyDedupeKey("b", "2026092915"));
    assert.notEqual(notifyDedupeKey("a", "2026092915"), notifyDedupeKey("a", "2026092916"));
  });
});

describe("notifyDedupeTtlSeconds", () => {
  it("outlives the current hour window without lingering", () => {
    const ttl = notifyDedupeTtlSeconds(Date.UTC(2026, 8, 29, 15, 20));
    assert.ok(ttl > 40 * 60 && ttl <= 61 * 60 + 60);
  });
});

describe("buildRateLimitMessage", () => {
  it("states sender, limit, and next window — and no secrets", () => {
    const msg = buildRateLimitMessage({
      senderEmail: "news@example.com",
      limit: 200,
      retryAtMs: Date.UTC(2026, 8, 29, 16, 0),
    });
    assert.ok(msg.includes("news@example.com"));
    assert.ok(msg.includes("200"));
    assert.ok(msg.includes("2026-09-29T16:00:00.000Z"));
    for (const secret of ["xox", "hooks.slack.com", "ENCRYPTION", "password", "client_secret"])
      assert.ok(!msg.toLowerCase().includes(secret), `leaks ${secret}`);
  });
});

describe("notifyHourlyLimit", () => {
  it("never throws when all infrastructure is down (best-effort contract)", async () => {
    await notifyHourlyLimit({
      senderId: "s1",
      senderEmail: "news@example.com",
      limit: 200,
      window: "2026092915",
      retryAtMs: Date.UTC(2026, 8, 29, 16, 0),
      emailId: "e1",
    });
  });
});
