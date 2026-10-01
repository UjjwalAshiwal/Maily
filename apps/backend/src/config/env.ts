const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`invalid numeric env value: ${v}`);
  return n;
};

const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.JWT_SECRET)
  throw new Error("JWT_SECRET is required in production");
if (isProd && !process.env.ENCRYPTION_KEY)
  throw new Error("ENCRYPTION_KEY is required in production");
if (isProd && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
if (isProd && !process.env.REDIS_URL) throw new Error("REDIS_URL is required in production");
if (isProd && !process.env.FRONTEND_URL) throw new Error("FRONTEND_URL is required in production");

const encryptionKey = process.env.ENCRYPTION_KEY ?? "";
if (encryptionKey !== "" && Buffer.from(encryptionKey, "hex").length !== 32)
  throw new Error("ENCRYPTION_KEY must be 32 bytes hex (openssl rand -hex 32)");

export const env = {
  PORT: num(process.env.PORT, 4000),
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  FRONTEND_URL: (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  WORKER_CONCURRENCY: num(process.env.WORKER_CONCURRENCY, 5),
  MIN_DELAY_MS: num(process.env.MIN_DELAY_MS, 2000),
  MAX_EMAILS_PER_HOUR: num(process.env.MAX_EMAILS_PER_HOUR, 200),
  QUEUE_ADD_TIMEOUT_MS: num(process.env.QUEUE_ADD_TIMEOUT_MS, 10_000),
  ETHEREAL_HOST: process.env.ETHEREAL_HOST ?? "smtp.ethereal.email",
  ETHEREAL_PORT: num(process.env.ETHEREAL_PORT, 587),
  ETHEREAL_USER: process.env.ETHEREAL_USER ?? "",
  ETHEREAL_PASSWORD: process.env.ETHEREAL_PASSWORD ?? "",
  ETHEREAL_FROM: process.env.ETHEREAL_FROM ?? "reachinbox@test.local",
  ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/api/auth/google/callback",
  JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-change-me",
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID ?? "",
  SLACK_REDIRECT_URI: process.env.SLACK_REDIRECT_URI ?? "http://localhost:4000/api/slack/callback",
  ENCRYPTION_KEY: encryptionKey,
  // ponytail: closed by default, open only when explicitly enabled
  BULL_BOARD_ENABLED: process.env.BULL_BOARD_ENABLED === "true",
};
