import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

// Provider boundary: plain fetch, no Slack SDK. Never logs secrets.
// Credential model: the app requests the `incoming-webhook` scope, so the
// usable credential is the webhook URL — that is what gets stored
// (encrypted) in SlackConnection.accessToken. No channel picker needed.

// PKCE (RFC 7636, S256): required for the localhost ("desktop") redirect.
// The verifier lives only in server-side Redis state; the URL carries just
// the challenge. Neither is ever logged.
export const newCodeVerifier = (): string => randomBytes(32).toString("base64url");

export const codeChallengeFor = (verifier: string): string =>
  createHash("sha256").update(verifier, "utf8").digest("base64url");

export const buildSlackAuthUrl = (state: string, codeChallenge: string): string => {
  // incoming-webhook is a BOT-only scope (Slack scope catalog: Bot, Legacy
  // Bot — no user-scope equivalent exists), so it must stay in `scope=`.
  // Bot scopes require a public HTTPS redirect; localhost is a "desktop
  // redirect" and is rejected. Local dev therefore tunnels via https
  // (see SLACK_REDIRECT_URI) instead of weakening anything.
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: "incoming-webhook",
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
};

export interface SlackOAuthResult {
  teamId: string;
  webhookUrl: string;
}

export const exchangeSlackCode = async (
  code: string,
  codeVerifier: string
): Promise<SlackOAuthResult> => {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // PKCE exchange: the verifier proves this client made the authorize
    // request, so no client_secret is sent here.
    body: new URLSearchParams({
      code,
      client_id: env.SLACK_CLIENT_ID,
      redirect_uri: env.SLACK_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error("slack token exchange failed");
  const body = (await res.json()) as {
    ok?: boolean;
    error?: string;
    team?: { id?: string };
    incoming_webhook?: { url?: string };
    authed_user?: { incoming_webhook?: { url?: string } };
  };
  const webhookUrl = body.incoming_webhook?.url ?? body.authed_user?.incoming_webhook?.url;
  if (body.ok !== true || !body.team?.id || !webhookUrl)
    throw new Error(`slack oauth refused${body.error ? `: ${body.error}` : ""}`);
  return { teamId: body.team.id, webhookUrl };
};

// Incoming webhooks answer plain "ok", not JSON.
export const postSlackWebhook = async (webhookUrl: string, text: string): Promise<void> => {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || (await res.text()).trim() !== "ok")
    throw new Error(`slack webhook failed with status ${res.status}`);
};
