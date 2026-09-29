# Architecture

## Current (implemented and tested)

```
Next.js → Express (`/emails`, `/auth`, `/slack`, `/senders`) → Prisma (Postgres) + BullMQ delayed jobs (Redis) → Worker → Ethereal SMTP → Slack webhook. Search: ES `emails` index. Bull-Board at `/admin/queues`.
```

Express + TypeScript, pino logging, error middleware. Docker Compose provides Postgres, Redis, Elasticsearch. Auth (Google OAuth + email/password JWT), email scheduling/sending, BullMQ queue + worker, Elasticsearch indexing/search, per-sender Redis rate limiting with reschedule, Slack OAuth + hourly-limit notifications, and the Next.js frontend are all implemented (see README for the full map).

## Phase 6 — Authentication (current)

```
Browser → GET /api/auth/google → Google → /api/auth/google/callback
  → find/create User (PostgreSQL) → JWT (sub=userId, 7d) → frontend (?token=…)
API calls: Authorization: Bearer <jwt> → requireAuth → User from PostgreSQL
```

- **Mechanism: stateless JWT**, chosen over server-side sessions because the
  backend already runs multiple worker processes and JWT needs no shared
  session store, no sticky routing, and no new dependency (`jsonwebtoken`
  was already listed). Trade-off: no server-side revocation — logout is
  client-side discard and a token lives until its 7-day expiry. Acceptable
  here; no revocation requirement exists.
- **OAuth without an OAuth library:** plain `fetch` to Google's token and
  userinfo endpoints. CSRF `state` in Redis (10-min TTL), never process
  memory. Only Google-verified emails are accepted; an existing row with the
  same verified email is adopted (googleId linked), never duplicated.
- **Ownership:** schedule checks `sender.userId` (404 either way, no
  existence oracle); search resolves the caller's sender IDs from
  PostgreSQL and scopes the ES query (empty list short-circuits). The
  BullMQ worker keeps using DB relationships — no HTTP auth there.
- Provider tokens are never logged, never returned, never stored.

## Phase 7 — Slack (current)

```
GET /api/slack/connect (auth) → Slack → /api/slack/callback (?code&state)
  → state → userId → exchange → upsert SlackConnection (encrypted webhook URL)
Worker HOURLY_LIMIT → sender → user → SlackConnection → webhook POST → reschedule
```

- **Credential model:** the app requests only the `incoming-webhook` scope,
  so the stored credential is the webhook URL (AES-256-GCM in
  `SlackConnection.accessToken`, key from `ENCRYPTION_KEY`). No channel
  picker, no extra columns, no new tables. Status/disconnect never expose it.
- **OAuth state:** `slack:oauth:{random}` → userId in Redis, 10-min TTL,
  single-use. The callback is public (Slack redirects without our JWT);
  the consumed state is what authenticates the user.
- **Notification dedupe:** `slack:notified:{senderId}:{UTC-hour}` via atomic
  `SET NX` with a TTL outliving the window — N concurrent workers yield one
  message. A claimed-but-failed send is accepted as lost (no spam) rather
  than retried into duplicates.
- **Best-effort contract:** `notifyHourlyLimit` never throws. No connection
  or Slack API failure touches the email's state, schedule, or SMTP retry
  path.

## Phase 8 — Bull Board (current)

```
Express /admin/queues → BullMQAdapter(emailQueue) → same email-send queue
```

- **Same queue, observed:** the adapter wraps the existing `emailQueue`
  instance — one queue, one name (`email-send`), one connection. Queue
  semantics (concurrency, retries, delays, job IDs, rescheduling) untouched.
- **Security: dev-only flag.** `BULL_BOARD_ENABLED` (default true) mounts the
  route; `false` unmounts it (404). No login on the dashboard: a shared
  secret was rejected because Bull Board's internal UI calls would not
  forward it, and no new auth dependency was warranted. Production must
  disable the route or proxy-protect it.
- **State separation:** BullMQ job states vs PostgreSQL `Email.status` are
  independent machines; the dashboard displays the former, the worker owns
  transitions of the latter.
