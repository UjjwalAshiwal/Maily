export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:3000",
  WORKER_CONCURRENCY: Number(process.env.WORKER_CONCURRENCY ?? 5),
  MIN_DELAY_MS: Number(process.env.MIN_DELAY_MS ?? 2000),
  MAX_EMAILS_PER_HOUR: Number(process.env.MAX_EMAILS_PER_HOUR ?? 200),
  ETHEREAL_HOST: process.env.ETHEREAL_HOST ?? "smtp.ethereal.email",
  ETHEREAL_PORT: Number(process.env.ETHEREAL_PORT ?? 587),
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
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
  // Development-only dashboard flag (see bull-board.ts). Production must set
  // false or put /admin/queues behind proxy auth — there is no login on it.
  BULL_BOARD_ENABLED: process.env.BULL_BOARD_ENABLED !== "false",
};
