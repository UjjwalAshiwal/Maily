import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../utils/logger.js";

// Stateless JWT auth: the token carries only the server-issued user id
// (sub). No roles/permissions inside — ownership is always resolved from
// PostgreSQL per request. Logout is client-side discard (documented trade-off:
// a JWT stays valid until its 7-day expiry; no revocation list by design).
if (!process.env.JWT_SECRET) logger.warn("JWT_SECRET not set, using insecure dev default");

export const signToken = (userId: string): string =>
  jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: "7d" });

export const verifyToken = (token: string): { sub: string } | null => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: unknown };
    return typeof payload.sub === "string" ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
};

// Email/password auth (stdlib scrypt, no new dependency). Format:
// `scrypt$<salt-hex>$<hash-hex>` with fixed params; compare is constant-time.
const SCRYPT_KEYLEN = 64;

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  try {
    const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
    const expectedBuf = Buffer.from(expected, "hex");
    return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
  } catch {
    return false;
  }
};

export const signupWithPassword = async (input: { email: string; name?: string; password: string }) => {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw Object.assign(new Error("email already registered"), { status: 409 });
  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name?.trim() || input.email.split("@")[0],
      passwordHash: hashPassword(input.password),
    },
  });
};

export const loginWithPassword = async (input: { email: string; password: string }) => {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Generic message either way: never reveal whether the email exists.
  if (!user || !user.passwordHash || !verifyPassword(input.password, user.passwordHash))
    throw Object.assign(new Error("invalid email or password"), { status: 401 });
  return user;
};

// OAuth state (CSRF protection) lives in Redis, never in process memory.
const stateClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
stateClient.on("error", () => {});

export const buildGoogleAuthUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

const storeOAuthState = async (state: string): Promise<void> => {
  await stateClient.set(`oauth:state:${state}`, "1", "EX", 600);
};

export const consumeOAuthState = async (state: string): Promise<boolean> => {
  const key = `oauth:state:${state}`;
  const found = await stateClient.get(key);
  if (!found) return false;
  await stateClient.del(key);
  return true;
};

export const newOAuthState = async (): Promise<string> => {
  const state = randomUUID();
  await storeOAuthState(state);
  return state;
};

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

// Provider boundary: plain fetch, no OAuth library. Never logs tokens.
export const exchangeCodeForProfile = async (code: string): Promise<GoogleProfile> => {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error("google token exchange failed");
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) throw new Error("google token exchange failed");

  const meRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) throw new Error("google profile fetch failed");
  const profile = (await meRes.json()) as GoogleProfile;
  if (!profile.sub || !profile.email || profile.email_verified !== true)
    throw new Error("google account is missing a verified email");
  return profile;
};

export const findOrCreateUser = async (profile: GoogleProfile) => {
  const byGoogleId = await prisma.user.findUnique({ where: { googleId: profile.sub } });
  if (byGoogleId) {
    const name = profile.name ?? byGoogleId.name;
    const avatarUrl = profile.picture ?? byGoogleId.avatarUrl;
    if (name !== byGoogleId.name || avatarUrl !== byGoogleId.avatarUrl)
      return prisma.user.update({ where: { id: byGoogleId.id }, data: { name, avatarUrl } });
    return byGoogleId;
  }
  // No Google link yet. A Google-verified email is a safe identity match,
  // so adopt the existing row rather than creating a duplicate account.
  const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
  if (byEmail)
    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        googleId: profile.sub,
        name: profile.name ?? byEmail.name,
        avatarUrl: profile.picture ?? byEmail.avatarUrl,
      },
    });
  return prisma.user.create({
    data: {
      googleId: profile.sub,
      email: profile.email,
      name: profile.name ?? profile.email,
      avatarUrl: profile.picture,
    },
  });
};
