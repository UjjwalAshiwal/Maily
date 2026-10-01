# Maily — Email Scheduler

A small email scheduling app: schedule emails from a dashboard, they go out on time even if the server restarts. Built with Express + BullMQ on the backend and Next.js on the frontend.

## Run it

```bash
cp .env.example .env
docker compose up -d   # postgres, redis, elasticsearch
cd apps/backend && npm i && npx prisma migrate deploy && npm run dev
curl localhost:4000/health
cd ../frontend && npm i && npm run dev   # http://localhost:3000
```

## Ethereal (fake email)

1. Go to https://ethereal.email and create a free test mailbox (one click).
2. Put the SMTP details in `.env`: `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, `ETHEREAL_PASSWORD`, `ETHEREAL_FROM`.
3. Schedule an email. The backend log prints a `previewUrl` — open it to see the message.

No credentials means sending fails and BullMQ retries like any other error.

## How scheduling works

- You hit `POST /api/emails/schedule`. The backend saves the email in Postgres as `SCHEDULED` and adds a BullMQ delayed job (`delay = scheduledAt - now`, id `email-<id>`).
- When the time comes the worker picks it up, flips it to `PROCESSING`, sends it through Ethereal, then marks it `SENT` (or `FAILED` after 3 tries).
- `SENT` and `FAILED` emails are never touched again. If the server dies mid-send, the same job runs again on restart (stable id, so no duplicate job) and finishes the work. No cron anywhere.
- Same email can't be sent twice by two workers: only the worker that flips `SCHEDULED → PROCESSING` first gets to send; the other backs off. Replaying a request with the same `idempotencyKey` just returns the original row.

## Rate limiting

Two per-sender limits, both kept in Redis so extra workers don't break them:

- `MIN_DELAY_MS` (default 2000) — gap between sends.
- `MAX_EMAILS_PER_HOUR` (default 200) — sends per sender per hour.

Both are atomic Redis operations. If the hourly limit is hit, the job is pushed to the next hour with the same job id — nothing is dropped, the email stays `SCHEDULED` until it can go. Order is best-effort under load.

```bash
MIN_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=200
WORKER_CONCURRENCY=5
```

The compose screen's delay/hourly boxes shape each recipient's send time up front; the server limits above are the backstop that always applies.

## Login

- Google login: browser → `/api/auth/google` → Google → callback → we find or create your user → JWT (7 days) → dashboard. Login state lives in Redis for 10 minutes during the handshake.
- Email + password also works (`/api/auth/signup`, `/api/auth/login`). Same JWT after that.
- Every `/api/*` call needs `Authorization: Bearer <token>`. Logout just deletes the token on your device.

## Senders

`GET/POST /api/senders`, `DELETE /api/senders/:id`. Deleting is soft — old emails stay visible. You can't delete a sender that still has scheduled mail (409). Sending always uses the Ethereal setup, never per-sender passwords.

## Edit / unschedule

- `DELETE /api/emails/:id` — only your own, only while `SCHEDULED`. Removes the queued job too.
- `PATCH /api/emails/:id` — edit recipient/subject/body/time/sender, re-queues under the same job id.
- `GET /api/emails/:id` — read one email.

## Slack

1. Make an app at https://api.slack.com/apps, turn on incoming webhooks.
2. Set `SLACK_CLIENT_ID`, `SLACK_REDIRECT_URI`, `ENCRYPTION_KEY` (`openssl rand -hex 32`). No secret needed.
3. Localhost needs an https tunnel for Slack (bot scopes reject plain localhost): `cloudflared tunnel --url http://localhost:4000`, use that URL as the redirect.

Dashboard → Connect Slack → authorize. When one of your senders hits the hourly cap, you get one message per sender per hour. Nothing connected means no message and no crash. Reconnecting just works.

## Search

Postgres owns the data; Elasticsearch (`emails` index) is just a search copy and can lag a little. `GET /api/emails/search?q=...` tries Elasticsearch first and falls back to Postgres if it's down, so search never 500s. Reindex everything with `npm run search:index` in `apps/backend`.

## Frontend

Sidebar (user, Compose, Scheduled/Sent counts, Settings) + list (search, rows with status badge, star, click for detail).

Pages: `/login`, `/auth/callback`, `/dashboard/scheduled` (edit/unschedule), `/dashboard/sent` (All/Sent/Failed), `/dashboard/compose` (sender, recipients, CSV upload with count, subject, delay/hourly with plan preview, Send Later), `/dashboard/emails/[id]`, `/dashboard/settings` (senders + Slack).

Same-origin `/api/*` calls get rewritten to the backend. For split hosting set `NEXT_PUBLIC_API` at build time.

## Queue dashboard

The live BullMQ view lives at `/admin/queues` (waiting/active/delayed/done/failed). It has no login, so it's off by default — set `BULL_BOARD_ENABLED=true` only when you need a look, then turn it back off.

## Tests

```bash
cd apps/backend && npm test
cd apps/backend && npx tsc --noEmit
cd apps/frontend && npm test && npx tsc --noEmit
```

## Things I'd do with more time

- Real logout (token blocklist) instead of client-side discard.
- Exactly-once sending (right now a crash between "sent" and "saved as sent" can double-send).
- Login on the queue dashboard instead of an on/off flag.
- Managed Elasticsearch for the hosted demo instead of local-only.

## Demo (3–5 min)

1. `docker compose up -d`, backend + frontend up, `/health` 200.
2. Log in (Google or email) → add a sender → Compose → upload CSV → set delay/limit → schedule → shows under Scheduled.
3. `/admin/queues` → delayed job fires → Sent view with time.
4. Open one, edit one, unschedule one.
5. Rate limit: `MAX_EMAILS_PER_HOUR=2`, schedule 3 → 2 sent + 1 pushed to next hour, Slack message arrives.
6. Restart the backend mid-schedule → jobs still send.
