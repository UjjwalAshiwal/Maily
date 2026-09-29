import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, buildGoogleAuthUrl } from "./auth.service.js";
import { env } from "../config/env.js";

// No live Google/Redis/PG here — provider exchange and user CRUD need
// Docker + real credentials (environment-blocked).
describe("JWT", () => {
  it("round-trips the user id", () => {
    assert.equal(verifyToken(signToken("u1"))?.sub, "u1");
  });
  it("rejects malformed payloads and keys", async () => {
    assert.equal(verifyToken("nope"), null);
    const { default: jwt } = await import("jsonwebtoken");
    assert.equal(verifyToken(jwt.sign({ sub: "u1" }, "another-secret")), null);
  });
  it("carries no claims besides sub and expiry", async () => {
    const { default: jwt } = await import("jsonwebtoken");
    const decoded = jwt.decode(signToken("u9")) as Record<string, unknown>;
    assert.equal(decoded.sub, "u9");
    assert.ok(typeof decoded.exp === "number");
    assert.ok(!("email" in decoded) && !("role" in decoded));
  });
});

describe("buildGoogleAuthUrl", () => {
  it("points at Google with our client, callback, and state", () => {
    const url = new URL(buildGoogleAuthUrl("state-abc"));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), env.GOOGLE_CLIENT_ID);
    assert.equal(url.searchParams.get("redirect_uri"), env.GOOGLE_CALLBACK_URL);
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("state"), "state-abc");
  });
});
