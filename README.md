# Maily Email Scheduler

> Mail-client dashboard (sidebar + lists + full-page compose) over a TypeScript/Express + BullMQ scheduling backend.

## Quick start

```bash
cp .env.example .env
docker compose up -d  # postgres, redis, elasticsearch
cd apps/backend && npm i && npx prisma migrate deploy && npm run dev
curl localhost:4000/health  # expect {"ok": true, ...}
cd ../frontend && npm i && npm run dev  # http://localhost:3000
```

## Ethereal setup

1. Create a free test mailbox at https://ethereal.email (no signup, one click).
2. Copy the SMTP credentials into `.env`:
   `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, `ETHEREAL_PASSWORD`, `ETHEREAL_FROM`.
3. Schedule an email; when the worker sends it, the log line `email sent`
   includes a `previewUrl` — open it in a browser to view the message.

Without credentials the worker throws `Ethereal SMTP credentials not configured`
and BullMQ retries per the queue's backoff policy.

## Email state transitions

```
SCHEDULED → PROCESSING → SENT (sentAt set, failure fields cleared)
SCHEDULED → … → FAILED (failedAt + errorMessage, after BullMQ attempts exhaust)
```

SENT and FAILED emails are never re-sent by the worker.

## Crash recovery (PROCESSING)

If the backend dies between the PROCESSING write and the terminal SENT/FAILED
write, BullMQ replays the same stable job (`jobId = email-<id>`) as a retry
(`attemptsMade > 0`) or stall recovery (`stalledCounter > 0`). The worker
recognizes both and reprocesses instead of skipping — a first delivery seeing
PROCESSING still skips (same-job concurrency is already prevented by BullMQ's
lock). See `src/queue/processing-recovery.ts`. No exactly-once claim: a crash
between SMTP acceptance and the SENT write can duplicate-send on recovery.

## SMTP retries

BullMQ owns retries (3 attempts, exponential backoff — see `email.queue.ts`).
Transient failures rethrow and retry; only the final attempt marks the Email
FAILED. No exactly-once guarantee is claimed: an SMTP acceptance immediately
before a process crash can result in a duplicate send.

## Rate Limiting

Two per-sender constraints, both coordinated in Redis so any number of
workers/processes stay consistent. PostgreSQL remains the source of truth
for Email state; Redis is only coordination state.

1. **Minimum delay** (`MIN_DELAY_MS`, default 2000): spacing between sends
   per sender. Workers atomically claim the next slot; five simultaneous
   workers get five distinct slots (now, +2s, +4s, …).
2. **Hourly limit** (`MAX_EMAILS_PER_HOUR`, default 200): sends consumed per
   sender per UTC hour window (`YYYYMMDDHH`).

**Atomicity:** two small Lua scripts — one allocates the min-delay slot,
one consumes hourly quota only if quota remains (GET-then-SET races are
not used anywhere). Quota is consumed only when a slot is actually
allocated, never for a job that is merely inspected.

**Multiple workers:** safe by construction — slot assignment and quota
consumption are each a single atomic Redis operation.

**Rescheduling:** a rate-limited job is moved to a future delayed execution
of the *same* BullMQ job (`moveToDelayed` + `DelayedError`, so BullMQ skips
the completed/failed transition), never duplicated, never failed.
The Email stays SCHEDULED until it is actually sendable; only then does it
become PROCESSING. Rate limiting is not an error, so BullMQ failure/retries
still mean real processing failures (e.g. SMTP).

**Reserve-once:** each email reserves exactly one slot, stored per email
(`rl:email:{id}:slot`). Delayed wakes only wait for their stored slot — they
never re-reserve (re-reserving diverges: every wake allocates a future slot).
Retries reuse the stored slot; it is cleared on SENT / terminal FAILED.

**Ordering:** best-effort — slots go to workers in Redis arrival order.

**Trade-offs:** slot allocation and quota check are two separate atomic
steps, so a job that takes a slot and then finds quota exhausted leaves a
small gap in the sender's spacing (conservative: never sends early). A
retried send consumes quota again. Exactly-once is not claimed (see above).

Example:

```bash
MIN_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=200
WORKER_CONCURRENCY=5
```

## Per-compose pacing (delay / hourly limit)

The compose screen asks for **Delay between 2 emails** and **Hourly Limit**
per request. These are computed client-side into each recipient's
`scheduledAt` (start + i·delay, hourly overflow spilling to the next hour
top, with a plan preview). No per-request backend controls were added on
purpose: an hourly window budget is inherently shared per sender, so the
server keeps one enforceable Redis-backed policy while the compose values
visibly determine each email's schedule. The worker's reservation flow is
unchanged.

## Authentication (Google OAuth + email/password, JWT)

- Google: browser → `GET /api/auth/google` → Google →
  `/api/auth/google/callback` → user found/created → JWT (`sub` = user id,
  7-day expiry) → `{FRONTEND_URL}/auth/callback?token=…`. Configure
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, and
  `JWT_SECRET` (long random value in production). OAuth `state` lives in
  Redis (10-min TTL) for CSRF protection.
- Email/password: `POST /api/auth/signup` (409 if taken, 400 if password
  < 8 chars) and `POST /api/auth/login` (401 `invalid email or password`
  for unknown/wrong/Google-only accounts alike). Passwords are stdlib-scrypt
  hashes with per-user salts; same JWT session as Google afterwards.
- APIs take `Authorization: Bearer <token>`. `GET /api/auth/me` returns the
  safe profile (never provider tokens or hashes); `POST /api/auth/logout`
  returns `{ok:true}` — JWTs are stateless, so logout means the client
  discards the token (valid until expiry by design).
- Ownership: schedule/edit requires the sender/email to belong to the
  caller (else 404); search/detail/list are scoped to the caller's data
  resolved from PostgreSQL. The worker uses DB relationships, not HTTP auth.

## Senders

- `GET /api/senders` (caller's live senders), `POST /api/senders`
  (Zod-validated email, always owned by the caller), `DELETE
  /api/senders/:senderId`.
- Deletion is a soft delete (`deletedAt`): the sender leaves the dropdown
  but every email stays visible/searchable. Senders with SCHEDULED or
  PROCESSING mail refuse with 409; history never blocks removal.
- No SMTP credentials on Sender — sending always uses the Ethereal config.

## Scheduled email management

- `DELETE /api/emails/:emailId` (unschedule): owner-only, SCHEDULED-only
  (else 409); removes the BullMQ delayed job by stored `bullJobId`
  (missing jobs are safe no-ops), then deletes the record + index doc.
  The conditional delete fails safe to 409 if a worker flips the row to
  PROCESSING mid-request.
- `PATCH /api/emails/:emailId`: owner-only, SCHEDULED-only; editable:
  recipient/subject/body/scheduledAt/senderId with the same Zod rules
  (future start, owned sender). Re-enqueues the SAME email under the stable
  `email-<id>` job with a fresh rate-limit slot; `id`/`idempotencyKey`
  never change.
- `GET /api/emails/:emailId`: owner-only single-email read for detail.

## Slack (OAuth + PKCE + hourly-limit notifications)

- Create a Slack app at https://api.slack.com/apps with **incoming
  webhooks** enabled; set `SLACK_CLIENT_ID`,
  `SLACK_REDIRECT_URI`, and `ENCRYPTION_KEY` (`openssl rand -hex 32`).
  No client secret is used (PKCE flow).
- `incoming-webhook` is a bot-only scope, so localhost needs an https
  tunnel for development (bot scopes are rejected on non-web redirects):
  run `cloudflared tunnel --url http://localhost:4000` and set
  `SLACK_REDIRECT_URI` to `https://<tunnel>/api/slack/callback` (also
  saved in the app's Redirect URLs).
- `GET /api/slack/connect` (302) and `GET /api/slack/connect-url` (same
  URL as JSON for browsers, which can't send the JWT on navigation) →
  Slack → `/api/slack/callback` stores an AES-256-GCM-encrypted
  incoming-webhook URL in `SlackConnection` (reconnect upserts, never
  duplicates). Each attempt mints fresh PKCE (`code_verifier` in
  server-side Redis state only, S256 challenge in the URL, no secret in
  the PKCE exchange). `GET /api/slack/status` never exposes the
  credential; `POST /api/slack/disconnect` removes it.
- When a sender hits the hourly limit, the worker notifies that sender's
  owner's Slack: exactly one message per sender per UTC hour via atomic
  Redis `SET NX` (`slack:notified:{senderId}:{window}`). Best-effort — Slack
  failure never fails, delays, or resends the email job, which reschedules
  unconditionally.

## Elasticsearch

PostgreSQL is the source of truth for Email state; Elasticsearch (`emails`
index) is a search index and is eventually consistent with it. There may be
a short window where PostgreSQL says SENT while the index still says
PROCESSING — that is accepted, never papered over with fake transactions.

- **Runs:** `docker compose up -d` (port 9200). Configure via
  `ELASTICSEARCH_URL` (default `http://localhost:9200`).
- **Index/mapping:** `emails`, explicit mapping (`id`/`senderId`/`status`
  keyword, `recipient` keyword+text, `subject`/`body` text, date fields).
  Created idempotently on first use; existing documents are never destroyed.
- **Init/reindex:** `cd apps/backend && npm run search:index` reindexes all
  PostgreSQL emails and reports indexed/failed counts. Never runs on boot.
- **Search API:** `GET /api/emails/search?q=john&status=SENT&page=1&limit=20`
  → `{ results: [{ id, senderId, recipient, subject, body, status,
  scheduledAt, sentAt }], total }`. Empty/missing `q` returns empty (no
  match-all). Max `limit` 100. No ES internals leak into the response.
- **When ES is down:** scheduling, BullMQ, and sending keep working;
  indexing failures are logged with `emailId`/`operation` and swallowed —
  the worker never resends because the index failed. Search falls back to
  Postgres `ILIKE` (same shape), never 500s.

## Frontend (Next.js mail client)

Sidebar layout (brand, user chip, Compose, Scheduled/Sent with live
counts, Settings) + main list (pill search, rows with time pill,
subject + body preview, star, click-through detail).

Routes: `/login` (Google + working email/password), `/auth/callback`,
`/dashboard` (→ scheduled), `/dashboard/scheduled` (Edit/Unschedule),
`/dashboard/sent` (All/Sent/Failed tabs), `/dashboard/compose`
(full-page: sender dropdown, recipient chips + list upload, subject,
delay/hourly pacing with plan preview, body, Send + Send Later popup),
`/dashboard/emails/[id]` (detail), `/dashboard/settings` (Senders +
Slack), `/settings` (Slack OAuth return).

- Compose: every recipient becomes one `POST /api/emails/schedule` call —
  one Email record/job each, paced per the delay/hourly inputs. No bulk
  endpoint. CSV parsing: header-based (`email`/`recipient`/`address`),
  headerless single-column accepted, invalid rows flagged, duplicates
  dropped, chips before submit.
- Edit reuses the compose form in a dialog (prefill → PATCH); unschedule
  confirms first. Backend errors shown inline, never raw stacks.
- Dev proxy: same-origin `/api/*` rewrites to the backend **with** the `/api`
  prefix preserved. Set `NEXT_PUBLIC_API`/`NEXT_PUBLIC_API_URL` for split origins.
- UI: Tailwind + green accent, single inline SVG icon set, CSS-only
  transitions, `prefers-reduced-motion` respected. No heavy UI deps.

## Bull Board

Live dashboard for the existing `email-send` queue at
`http://localhost:4000/admin/queues` (waiting / active / delayed /
completed / failed — the normal BullMQ operational view).

- Observes the same queue instance: same name, same connection, same
  semantics. Nothing about scheduling, retries, or sending changed.
- **Security: development-only, no login.** Disabled by default
  (`BULL_BOARD_ENABLED` must be `"true"` to mount); otherwise the route
  returns 404. In production put `/admin/queues` behind proxy auth.

## Testing

```bash
cd apps/backend && npm test        # node:test suites (includes worker, PKCE, recovery)
cd apps/backend && npx tsc --noEmit && npx prisma validate
cd apps/frontend && npm test && npx tsc --noEmit && npm run build
npm run search:index               # (in apps/backend) reindex PG → ES, reports counts
```

## Known limitations

- JWTs are stateless (7-day expiry, no server revocation); logout = client discards token.
- No exactly-once SMTP: crash between provider acceptance and DB write can duplicate-send (worker skips SENT/FAILED, idempotencyKey unique, stable `jobId = email-<id>`).
- Rate slots reserve once per email; a crash between reserve and send leaks one quota unit (conservative).
- ES is eventually consistent with PG (short SENT skew accepted); scheduling/sending never depend on it.
- Per-compose delay/hourly are client-side schedule computation, not server overrides; the server policy stays single and Redis-backed.
- Soft-deleted senders keep their emails visible; scheduling with one 404s.
- Error bodies are generic (`internal error` on 500, never Prisma/SMTP internals); `ZodError` maps to 400.
- 1000+ emails at once: each reserves one slot/counters atomically, over-limit jobs spill to the next hour via the same delayed job (no drops, order best-effort).
- `/admin/queues` has no login — disable in production or proxy-protect it.
- Tunnel-based Slack redirect URLs change per tunnel restart (production uses a stable https URL).

## Demo flow (3–5 min)

1. `docker compose up -d`, backend `npm run dev` → `/health` 200; frontend `npm run dev` → `/login`.
2. Sign up with email/password (or Login with Google) → sidebar with counts.
3. Settings → Add sender → Compose → chips + CSV upload → set delay/hourly → Send Later preset → schedule → appears under Scheduled.
4. Bull Board `/admin/queues` → delayed job `email-<id>` → fires → completed → Sent view with `sentAt`.
5. Open the email (detail), edit a scheduled one, unschedule one.
6. Rate limiting: `MAX_EMAILS_PER_HOUR=2`, schedule 3 → 2 SENT + 1 delayed to next hour; Slack message arrives if connected.
7. Restart: stop backend mid-schedule → start → delayed jobs still send (PROCESSING crash recovers via stall retry).
8. Architecture in 30s: Next → Express → PG + BullMQ/Redis → worker → Ethereal/Slack; ES read-only search.
