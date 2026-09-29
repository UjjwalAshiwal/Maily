# PROJECT MEMORY

## Project
ReachInbox Email Scheduler

## Current Phase
Phase 10 — Integration Testing, Hardening & Demo Readiness

## Current Status
IMPLEMENTATION COMPLETE. Live integration run against real Docker services (PG/Redis/ES), real Ethereal SMTP, real JWTs: scheduling, idempotency, min-delay, hourly limit + reset, ES indexing/search/outage/reindex, Bull Board flag, restart persistence, frontend E2E, CSV E2E, Redis-down and SMTP-down failure paths all exercised. Two real bugs found and fixed (worker reschedule crash + non-converging slot re-reservation) plus two hardenings (queue-add timeout, empty-error fallback). BLOCKED (no creds): live Google OAuth roundtrip, live Slack delivery, multi-process workers, PG-down path. No Phase 11 exists — this is the final phase.

## Phase 10 Test Log (2026-09-29, live Docker on local Mac)

Infra: `docker compose up -d` → PG 16 / Redis 7 (AOF) / ES 8.13 all healthy first try. `.env` created from example (dev-only secrets, gitignored, never committed). `prisma migrate deploy` → applied. First-ever live `/health → 200 {"ok":true,"postgres":"up","redis":"up"}`. Ethereal mailbox generated via `nodemailer.createTestAccount()`. Seed: User A (senders A1,A2) + User B (sender B1) + real JWTs (`/tmp` scripts, never in repo).

PASS (observed live):
- Auth/ownership: `/google` 302 with correct params (live OAuth BLOCKED, no client creds); `/me` per-user profiles; missing/wrong-secret tokens → 401; A scheduling with B's sender → 404; sender lists isolated; logout `{ok:true}`.
- Scheduling E2E: `POST /schedule` → 201 `{emailId, jobId: email-<id>, SCHEDULED}` → worker → real SMTP → SENT + `sentAt` + Ethereal preview URL; ES doc synced SENT; PG list + `senderEmail` shape; recipient/subject search + status filter + pagination; B sees none of A's data; search response leaks no ES internals.
- Idempotency: replayed SENT payload → `email already sent, skipping`, sent-count unchanged, no duplicate SMTP.
- Min-delay (MIN_DELAY_MS=2000, MAX=100, concurrency 5): 3 same-time mails sent with gaps ≈1.8s/2.0s, 0 worker errors, best-effort order.
- Hourly limit (MAX=2): 2 SENT, 2 stayed SCHEDULED (never FAILED/dropped), same jobIds rescheduled to next-hour start, hour counter exactly 2, 0 errors. At 10:00 UTC reset all 6 delayed jobs (2 quota + 4 earlier) SENT.
- ES: reindex 15/0; outage → schedule still 201, search clean 500, sends unaffected; after restart transients self-recovered, final docs correct.
- Bull Board: `/admin/queues` 200 with jobs; `BULL_BOARD_ENABLED=false` → 404, health unaffected.
- Restart persistence: delayed jobs (2030-dated CSV/esdown mails) + completed/failed history survived backend restarts; Redis AOF + PG volume intact (volumes never deleted).
- Frontend (prod `next start`): all pages 200; rewrite fix verified (authed `/me`, senders, lists through proxy); CSV E2E (4 rows → 2 valid scheduled 201 each, dup dropped, invalid never sent); 400 body `invalid request: Invalid email` with no internals.
- Failure paths: Redis down → schedule now 502 in ~10s + FAILED row (was: hangs forever — hardened, see below); bad SMTP creds → `Invalid login: 535`, BullMQ retries observed; Slack `/status {connected:false}` + `/disconnect {ok:true}`; HOURLY_LIMIT with no Slack connection → notify skipped, reschedule unaffected, 0 errors.
- Suites: backend 38/38 (37 + 1 new slot-key test), frontend 23/23, `tsc` clean both, `next build` 7 routes, `prisma validate` clean.
- Security review: no secrets in code (creds only in gitignored root `.env`), no console logging (pino only), no `/api/test` remnants, CORS locked to FRONTEND_URL, no NEXT_PUBLIC secrets, no browser-to-infra access, ownership enforced backend-side (frontend never trusted).

BUGS FOUND + FIXED (live-only, all unit tests had passed):
1. Worker `return` after `job.moveToDelayed()` → BullMQ "not in the active state / Missing lock" crash loop, retries burned, mails stuck SCHEDULED. Fix: `throw new DelayedError()` (the sanctioned signal; no retry consumed, no failure recorded). `email.worker.ts` only.
2. Slot re-reservation on every wake never converged (each wake allocated max(now,next)+delay → always future, `next` pointer ran away, mails never sent). Fix: reserve-once per email (`rl:email:{id}:slot`, 7d TTL, cleared on SENT/FINAL-FAILED; retries reuse). `rate-limit.service.ts` (+3 helpers, additive) + worker flow. Old stuck jobs self-healed under the fix.
3. Hardening: `emailQueue.add()` pends forever on Redis-down (BullMQ offline queue) →_bounded with `QUEUE_ADD_TIMEOUT_MS` (default 10s) → existing catch marks FAILED + 502. Fail-closed is safe (late add finds non-SCHEDULED → worker skips, verified in logs).
4. Hardening: `{"error":""}` on ES-outage 500s → `err.message || "internal error"` fallback. `error.middleware.ts` one line.

PARTIAL / BLOCKED (honest):
- SMTP-terminal FAILED state: retries + 535 observed live; exhaustion-to-FAILED inferred from code path (unchanged since Phase 3C), not observed (user stopped live testing).
- Multi-process workers: single-process concurrency 5 verified; second process not run (user stopped live testing). Redis Lua atomicity is the mechanism; documented, not re-proven live.
- PG-down behavior: not exercised (user stopped live testing). Expected from code: Prisma throws → 500 via middleware, no false success.
- Live Google OAuth roundtrip: BLOCKED, no client credentials (URL construction verified 302).
- Live Slack delivery + per-hour dedupe under concurrency: BLOCKED, no Slack app (connect/status/disconnect + no-connection reschedule verified; dedupe unit-tested Phase 7).
- Multi-worker Redis sharing across processes: see multi-process above.

Design record updates:
- `moveToDelayed` from inside a BullMQ 5 processor MUST be followed by `throw new DelayedError()`; bare return corrupts the completion flow.
- Rate slots are reserved once per email and stored; wakes only wait. Quota consumed once at reservation; retries reuse. Crash between reserve and send leaks one quota unit (conservative, accepted).
- Queue-add timeout makes Redis-down fail fast (502+FAILED) instead of hanging; safe because the worker skips non-SCHEDULED emails.

## Phase 9 Test Log (2026-09-29, sandbox without Docker/Google creds)

Backend additions (minimal, read-only, required for the frontend to function):
- `parseListParams`/`listSenders`/`listEmails` in `services/email.service.ts` (PG-authoritative, caller-scoped via relation, no client senderId, no ES); `listSendersHandler`/`listEmailsHandler`; `GET /api/senders` (new `sender.routes.ts`) + `GET /api/emails` on the existing auth-guarded router. No queue/worker/auth/ES file touched.
- `tsc --noEmit` → clean. `npm test` 37/37 (32 prior + 5 new `parseListParams` rules: defaults, valid/empty/invalid status 400, page/limit clamp max 100).
- Runtime (no PG/Redis): `/api/senders`, `/api/emails`, `/api/emails/search` → 401 without token, 401 on bogus token; valid-JWT (locally signed) passes signature check and reaches the PG user lookup (500 only because no DATABASE_URL/.env here — proves wiring, not a defect). Health 503 degraded as before.

Frontend (Next.js 14 App Router, Tailwind, zero new runtime deps):
- Routes: `/` (redirect), `/login` (CTA → backend `/api/auth/google`, `?error=oauth_failed` handling), `/auth/callback` (`?token=` → localStorage → `/dashboard`), `/dashboard` (Scheduled/Sent/Failed/Senders counts from real APIs), `/dashboard/scheduled`, `/dashboard/sent` (PG list default, ES search on query, pagination, loading/empty/error states).
- `lib/api.ts` typed client (base URL, Bearer, ApiError, no scattered fetch); `lib/auth.tsx` (`/me`, 401 clears token, logout); `lib/csv.ts` (header/headerless parse, invalid flags, dedupe); `lib/compose.ts` (validation, start-time default); single SVG icon family; CSS-only motion + reduced-motion.
- Compose dialog (single + bulk CSV): real sender IDs, future-time validation, per-recipient `POST /schedule` loop with progress + per-recipient errors, event-driven list refresh. Start-time picker only — min-delay/hourly-limit shown as server-owned note, no fake controls. No sender-management UI (no backend endpoint; empty state documents it).
- `tsc --noEmit` → clean. `npm test` 23/23 (login CTA URL, Bearer header, 401 ApiError, schedule payload shape, error surfacing, compose validation incl. TZ-safe future check, CSV parse/invalid/dedupe/headerless, EmptyState/ErrorState/StatusBadge/no-senders SSR renders).
- `next build` → clean, 7 routes. Production `next start` verified: all pages 200; `/api/*` proxies 401 unauthenticated through the rewrite.
- Fixes during phase: (1) pre-existing `next.config.ts` unsupported on Next 14 → converted to `.mjs`; (2) pre-existing rewrite stripped the `/api` prefix (every proxied call 404'd `Cannot GET /auth/me`) → destination now preserves it; (3) NodeNext `.js` import suffixes don't resolve under Next/webpack → extensionless imports across frontend src; (4) `Geist` not exported by Next 14 `next/font/google` → Inter stand-in, revisit on Next 15; (5) CSV headerless heuristic dropped first data row → first-line-looks-like-email means data; (6) `@types/react-dom` must match React 18 (`@types/react-dom@^18.3.0`).
- UI libs actually used: Tailwind only. Skipped: framer-motion, shadcn package, Hugeicons package, Aceternity/Magic UI (hand-rolled shadcn-style primitives + inline SVG set; motion would slow workflow, showcase components rejected per spec).

Environment-blocked (need Docker + Google OAuth client):
- Real Google login roundtrip, `/me`-driven shell, schedule → scheduled list → worker → sent list, CSV bulk end-to-end, failed-state card, search against live ES. First Docker run executes the Phase 9 runtime list (steps 1–16) before Phase 10.
- Never claimed: no real Google login was performed here; CTA verified in client bundle + unit test only.

Backend gaps discovered (Phase 9):
- No sender-list endpoint existed (scheduling needs senderId) → added minimal `GET /api/senders`.
- No email-list endpoint existed (`/search` requires non-empty q, so browsing scheduled/sent was impossible) → added minimal `GET /api/emails?status=&page=&limit=`.
- No sender-management endpoints → NOT built; UI shows empty state. No per-request rate-limit settings (env-level) → NOT faked; UI notes server ownership. No bulk schedule endpoint → NOT built; frontend loops single-schedule calls.

Known limitations:
- JWT in localStorage (follows the backend's documented `?token=` delivery; XSS-hygiene unchanged from Phase 6 design).
- Dashboard counts = 4 small list queries (limit=1 totals); no aggregate endpoint, no caching.
- Login/callback pages bail out to client-side rendering (useSearchParams) — SSR shows loading fallback; expected Next behavior.
- Prisma-error leak when PG is down (pre-existing, non-operating mode only).

## Phase 8 Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched, all service/worker paths untouched).
- New: `src/queue/bull-board.ts` (`BullMQAdapter` around the existing `emailQueue` instance, `ExpressAdapter` at `/admin/queues`), conditional mount in `server.ts` via `BULL_BOARD_ENABLED` (default true, `false` → 404). Same queue/connection/semantics — verified by reading the wiring, no queue file changed.
- `env.ts` + `.env.example`: `BULL_BOARD_ENABLED`. No new deps (`@bull-board/api` + `@bull-board/express` 5.23.0 were already installed; BullMQ 5.81.5).
- Issues found and fixed during phase: (1) NodeNext needs the explicit `.js` extension on the `bullMQAdapter.js` subpath import; (2) bull-board 5.23 `.d.ts` predates BullMQ 5.81's `JobProgress` typing — contained types-only casts with an explanatory comment, runtime shape unchanged; (3) importing the queue graph in tests opens BullMQ's eager Redis connection, which (no Redis) keeps the test process alive — `npm test` now uses `--test-force-exit` (results/exit codes unaffected; documented in the test file).

Tests run (`npm test`, 32/32 pass):
- 28 prior tests green. 4 new: router importable, queue name unchanged, adapter wraps the `email-send` instance, flag default true.

Runtime verified (no PG/Redis):
- `/admin/queues` → 200 dashboard shell with Redis down (boot safe, route registered). `BULL_BOARD_ENABLED=false` → 404, health unchanged.

Environment-blocked (need Docker):
- Live queue visibility (schedule → delayed job appears → worker processes → completed), delayed rate-limit display, restart persistence of the dashboard view. First Docker run executes that list without touching queue data.

## Phase 7 Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched — SlackConnection already had everything).
- New: `utils/encryption.ts` (AES-256-GCM, `iv:tag:cipher` hex, loud key validation), `integrations/slack.ts` (auth URL, `oauth.v2.access` exchange requiring team + webhook URL, webhook POST expecting plain `ok`; no SDK), `services/slack.service.ts` (user-bound Redis state 10-min TTL single-use; encrypted upsert preserving userId-unique; safe status; `notifyHourlyLimit` never-throws with atomic `SET NX` dedupe `slack:notified:{sender}:{window}`), `controllers/slack.controller.ts` + `routes/slack.routes.ts` (`/connect`, `/callback` public-via-state, `/status`, `/disconnect`), mounted at `/api/slack`.
- Worker: HOURLY_LIMIT branch notifies (sender→user→connection) then reschedules unconditionally; `findUnique` gains sender email for the message. Rate-limit Lua, SMTP, ES, auth paths untouched. No new deps.
- `env.ts` + `.env.example`: `SLACK_CLIENT_ID/SECRET/REDIRECT_URI`, `ENCRYPTION_KEY`. README/architecture/api docs added.

Tests run (`npm test`, 28/28 pass):
- 18 prior tests green. 10 new: encryption roundtrip/IV-randomness/wrong-key/tamper/malformed, Slack auth-URL params, dedupe key isolation, TTL bounds, message content + secret scan, notify never-throws with all infra down.

Runtime verified (no PG/Redis/Slack):
- Slack status/connect/disconnect without token → 401; callback without state → 302 (no crash); health 503 + schedule 401 unchanged.

Environment-blocked (need Docker + real Slack app):
- OAuth connect/callback roundtrip, encrypted row check, status/disconnect/reconnect, hourly-limit real delivery, single-message dedupe under concurrency, no-notification-after-disconnect. First Docker run executes that list.

## Phase 6 Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched — User model already had everything).
- New: `services/auth.service.ts` (JWT sign/verify `sub`-only 7d; Google auth URL builder; Redis-backed OAuth state 10-min TTL; fetch-based code exchange + userinfo with verified-email requirement; find-or-create by googleId then verified-email adoption), `middleware/auth.middleware.ts` (`requireAuth`, PG-reloaded user, typed `AuthenticatedRequest`), `controllers/auth.controller.ts` + `routes/auth.routes.ts` (`/google`, `/google/callback`, `/me`, `/logout`), mounted at `/api/auth`.
- Ownership: `POST /schedule` requires own sender (404 either way, no oracle); `GET /search` resolves caller senderIds from PG (authoritative) into ES `terms` filter, empty list short-circuits; `/api/emails` router now behind `requireAuth`. No sender-management endpoints built (none existed). Worker untouched (DB relationships, no HTTP auth). No new deps (`jsonwebtoken` was already listed).
- `env.ts` + `.env.example`: `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `JWT_SECRET`. README auth section + architecture JWT/ownership section + `docs/api.md` auth entries added.

Tests run (`npm test`, 18/18 pass):
- 10 prior tests green. 8 new: JWT roundtrip, malformed/foreign-secret rejection, sub-only claims, auth-URL params, middleware 401 on missing/malformed credential, search empty-senderIds short-circuit.

Runtime verified (no PG/Redis/Google):
- `/me`, schedule, search without token → 401; bad token → 401; logout → 200 `{ok:true}`; `/google` with Redis down → 500 without crash (state store needs Redis — honest degraded behavior); `/health` 503 unchanged.

Environment-blocked (need Docker + real Google credentials):
- Live OAuth roundtrip, find-or-create against PG, `/me` with real token, cross-user sender 404, search isolation between users, SENT/FAILED flows under auth. First Docker run: create Google OAuth client, set env, run those flows.

## Phase 5 Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched, API/scheduler/rate-limiter/sending paths unchanged).
- New: `src/integrations/elasticsearch.ts` (`emails` index, explicit mapping — `id`/`senderId`/`status` keyword, `recipient` keyword+text, `subject`/`body` text, date fields; no secrets indexed; idempotent `ensureEmailsIndex`; `indexEmailDocument`; `searchEmailDocuments` with optional `senderId` seam for future auth), `src/services/search.service.ts` (`syncEmailToIndex` best-effort/never-throws, pure `toSearchResponse`, empty-q short-circuit, status validation, page/limit clamp max 100), `GET /api/emails/search`, `src/scripts/search-index.ts` + `npm run search:index` (batched reindex with counts, never on boot).
- Wiring: index after Email create + after enqueue-failure FAILED mark; worker syncs after PROCESSING/SENT/FAILED writes. Sync never throws, never triggers SMTP retry, never changes PG state.
- `env.ts` + `.env.example`: `ELASTICSEARCH_URL`. No new deps (client was already installed). README `## Elasticsearch` + `docs/api.md` search entry added.

Tests run (`npm test`, 10/10 pass):
- 6 Phase-4 tests still green. 4 new: empty/missing q short-circuits without ES, invalid status rejected, response mapper exposes only the public shape.

Runtime verified (no PG/Redis/ES):
- Empty q → 200 `{results:[],total:0}` without touching ES. `q=john` → 500 (ES down; server alive). Bad status → 400. Schedule 400s unchanged (regression pass).

Environment-blocked (need Docker):
- Tests 1–8 from the Phase 5 spec (index on create, recipient/subject/body search, status sync, ES-outage scheduling/sending, reindex script, response format). First Docker run: `docker compose up -d` + `prisma migrate dev`, then execute.

Consistency model (documented in README/memory):
- PostgreSQL strongly authoritative; Elasticsearch eventually consistent. Short SENT-vs-PROCESSING skew accepted. No distributed transactions, no exactly-once claim beyond existing notes.

## Phase 4 Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched, API unchanged).
- New: `src/services/rate-limit.service.ts` (sender-scoped keys `rl:sender:{id}:next` + `rl:sender:{id}:hour:{UTC YYYYMMDDHH}`; Lua slot-allocation + Lua quota-consume scripts; `reserveSendSlot(senderId, requestedMs?)` → `{allowed, slotMs, window}` or `{allowed:false, HOURLY_LIMIT, retryAtMs, window}`; `MAX<1` throws loudly instead of rescheduling forever). Own lazy Redis client; health/queue clients untouched.
- Worker: SCHEDULED → reserve → HOURLY_LIMIT → `moveToDelayed(nextHourStart)` (same job, no duplicate, stays SCHEDULED) → slot-in-future → `moveToDelayed(slot)` → else PROCESSING + existing 3C send path. Structured decision logs (emailId/senderId/jobId/decision/reason/scheduledFor/window). No status-enum change; no cron/setTimeout; no new deps (`node:test` + tsx only, `npm test` added).
- `env.ts` + `.env.example`: `MIN_DELAY_MS=2000`, `MAX_EMAILS_PER_HOUR=200`. README `## Rate Limiting` section added.

Tests run (`npm test`, node:test, 6/6 pass):
- Window determinism, UTC (not local), hour-boundary rollover, next-hour-start math, sender isolation of both key types. Redis atomicity/multi-worker/hourly/reschedule/restart/SENT/FAILED tests need live Redis → environment-blocked (listed below).

Runtime verified (no PG/Redis):
- Boot + `/health` 503 + schedule 400s unchanged (regression pass).

Environment-blocked (need Docker):
- Tests 1–10 from the Phase 4 spec (min-delay spacing, 5-worker coordination, sender isolation, hourly allow/reschedule, concurrent quota atomicity, no-duplicate reschedule, restart persistence, SENT/FAILED protection, multi-process). First Docker run executes them against `reserveSendSlot` + worker.

Design record:
- Two Lua scripts (not one): window math stays in TS (UTC-safe, testable); each Redis mutation is independently atomic. Race between them only creates conservative spacing gaps, never over-admission or under-spacing.
- Quota consumed only on slot allocation, never on inspection; retried sends consume again (documented).
- No Slack event bus added — the `HOURLY_LIMIT` decision log line is the structured event a future Slack phase can consume.

## Phase 3C Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched, API unchanged).
- New: `src/integrations/ethereal.ts` (env-driven Nodemailer transporter, lazy singleton, returns `{messageId, previewUrl}`; missing creds throw a clear error). `env.ts` + `.env.example`: `ETHEREAL_HOST/PORT/USER/PASSWORD/FROM`. No SMTP logic in the worker file beyond the call.
- Worker: SCHEDULED → PROCESSING → send → SENT (`sentAt` set, `failedAt`/`errorMessage` cleared, logs emailId/recipient/jobId/previewUrl). SMTP throw → rethrow for BullMQ retry; final attempt (`attemptsMade + 1 >= opts.attempts`) marks FAILED + `failedAt`/`errorMessage`, still rethrows so the job visibly fails. SENT/FAILED guards skip without re-sending. `Email.attempts` intentionally untouched (BullMQ owns retry counting; a later phase may use the column).
- README: Ethereal setup, preview URL, transitions, retry policy. No rate-limit docs (future).

Runtime verified (no PG/Redis):
- Boot + `/health` 503 + schedule 400s unchanged (regression pass).

Environment-blocked (need Docker + Ethereal creds):
- Full 13-step spec list: SCHEDULED → delayed job → PROCESSING → Ethereal receipt → SENT + `sentAt` + preview URL; SENT no-reprocess; SMTP-failure retries; exhausted → FAILED. Honesty note kept: SMTP acceptance immediately before a crash can duplicate-send; DB-state check is best-effort, not exactly-once.

## Phase 3B Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched).
- New: `services/email.service.ts` (zod validation, sender-exists check, per-email `randomUUID` idempotencyKey, `delay = scheduledAt - now`, stable `jobId = email-<id>`, `bullJobId` stored; enqueue failure marks email FAILED + logs, never orphaned SCHEDULED), `controllers/email.controller.ts`, `routes/email.routes.ts`, mounted at `/api/emails`. Removed `POST /api/test/queue` (file deleted, unmounted).
- Worker: `{emailId}` payload → missing email throws; SENT skips with log; non-SCHEDULED skips safely; SCHEDULED → PROCESSING + logs emailId/recipient/jobId. No sending.

Runtime verified (no PG/Redis):
- `POST /api/emails/schedule {}` → 400 `invalid request: Required`.
- Bad email → 400 `Invalid email`. Past `scheduledAt` → 400 `scheduledAt must be in the future`.
- Valid body → 500 at sender lookup (PG down — proves request passed validation to DB layer). Error body leaks Prisma internals; acceptable for now (PG-down is not an operating mode), harden error responses in a later phase.
- `POST /api/test/queue` → 404 (removal confirmed).

Environment-blocked (need Docker):
- Happy path (row SCHEDULED → delayed job → worker → PROCESSING), SENT no-reprocess, missing-Email job error, restart persistence. First Docker run: `docker compose up -d` + `prisma migrate dev`, then run the 12-step spec list.

## Phase 3A Test Log (2026-09-29, sandbox without Docker)

Code verified:
- `tsc --noEmit` → clean. `prisma validate` → valid (schema untouched).
- New: `src/queue/connection.ts` (own ioredis instance per Queue/Worker, `maxRetriesPerRequest: null` as BullMQ requires; `/health` client untouched), `src/queue/email.queue.ts` (`email-send`, attempts 3 + exponential backoff, delayed-job ready via per-job `delay`), `src/queue/email.worker.ts` (logs jobId+payload, `failed`/`error` handlers, concurrency from `WORKER_CONCURRENCY` default 5), `POST /api/test/queue` dev-only endpoint (accepts `{message, delayMs?}`, returns `{jobId}`).
- `docker-compose.yml`: Redis now `redis-server --appendonly yes` + `redisdata` volume. `.env.example` + `env.ts`: added `WORKER_CONCURRENCY`.

Runtime verified (degraded, no Redis):
- Boot with worker loaded → stays up, worker `ECONNREFUSED` logged cleanly with full error detail, no crash (fixed empty-string log during test).
- `/health` → 503 degraded. `POST /api/test/queue` pends while Redis is down (BullMQ offline queue — inherent, not a defect); server stays responsive to other routes.

Environment-blocked (need Docker):
- Job completion, delayed-job + backend-restart persistence test, live `/health` → 200. First Docker run: `docker compose up -d`, `POST /api/test/queue {"message":"hello","delayMs":60000}`, restart backend, confirm worker processes it.

## Phase 2 Test Log (2026-09-29, sandbox without Docker)

- Schema: User (googleId/email unique) + Sender (FK userId) + Email (EmailStatus enum, SCHEDULED default, attempts default 0, idempotencyKey unique, indexes on senderId/scheduledAt/status/recipient/bullJobId) + SlackConnection (userId unique 1-1). No Campaign/Template/Tenant/RateLimit/Queue/SMTP/audit extras. No SMTP credentials on Sender.
- `prisma validate` → valid
- Migration SQL rendered via `prisma migrate diff --from-empty` (no live DB needed) → `prisma/migrations/20260929000000_init/migration.sql`; verified it contains the enum, all tables, uniques, indexes, FK cascades.
- `prisma migrate dev` NOT run — requires live PostgreSQL, none available. Migration is UNAPPLIED; first Docker environment must run `migrate dev`/`deploy` before Phase 3.
- `prisma generate` → client generated. `tsc --noEmit` → clean. Boot + `/health` → 503 degraded as expected.

## Phase 1 Cleanup Test Log (2026-09-29, sandbox without Docker)

- `import "dotenv/config"` added as first line of `src/server.ts`; temp `.env` with `PORT=4003` → boot log shows `backend listening on :4003` (proves runtime reads `.env`, not fallbacks). Temp `.env` removed after test.
- Deleted `apps/backend/prisma.config.ts` (Prisma 5 ignores it); `prisma validate` + `prisma generate` still pass.
- `docs/architecture.md` rewritten: Phase 1 actual vs target/future, nothing future claimed as done.
- `tsc --noEmit` → clean. `GET /health` → 503 degraded as expected (no Docker).

## Phase 1 Test Log (2026-09-29, sandbox without Docker)

- `prisma validate` → valid
- `prisma generate` → client generated (needs ≥1 model; bare User placeholder added, no logic)
- `tsc --noEmit` → clean
- `tsx src/server.ts` → boots, logs `backend listening on :4001`
- `GET /health` → 503 `{"ok":false,"postgres":"down","redis":"down"}` (correct: services unreachable, server stays up)
- Fixed during phase: single-line Prisma blocks rejected by Prisma 5; `pino-pretty` transport removed (package not installed, would crash boot); ioredis default import → named `Redis` import (NodeNext); premature future-phase files removed (auth/email/slack/queue/ES/frontend impl) back to Phase 1 scope

---

# Architecture Decisions

- Monorepo
- Backend: Express + TypeScript
- Frontend: Next.js + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Queue: BullMQ
- Queue storage: Redis
- SMTP: Ethereal
- Search: Elasticsearch
- Styling: Tailwind

---

# Completed

- [x] Repository structure
- [x] Docker Compose (file created; `docker compose up` NOT run — no Docker in sandbox)
- [ ] PostgreSQL connection (check logic tested; live "up" NOT verified — needs `docker compose up -d` + `curl /health`)
- [ ] Redis connection (same as above)
- [x] Prisma setup (`validate` + `generate` pass)
- [x] Database model design (User/Sender/Email/SlackConnection + EmailStatus enum, per Phase 2 spec, no extra models)
- [x] Prisma schema (4 models, constraints + indexes as specified)
- [x] Initial migration (SQL generated via `migrate diff`; UNAPPLIED — no live PostgreSQL in sandbox)
- [x] Prisma client generation (regenerated against new schema)
- [x] Basic Express server (boots, pino logging, error middleware wired, runtime dotenv loading verified)
- [x] Health endpoint (`GET /health` returns per-service status; 200 only when PG+Redis up)
- [x] Phase 1 cleanup: dead `prisma.config.ts` removed (Prisma cmds verified), `docs/architecture.md` split into Phase 1 actual vs target
- [x] Email database model
- [x] BullMQ dependency/configuration (package dep now wired: connection + queue + worker)
- [x] Persistent Redis configuration (AOF + `redisdata` volume in compose)
- [x] Email queue (`email-send`, delayed-job ready)
- [x] Email worker (logs jobId+payload, clean error handling)
- [x] Configurable worker concurrency (`WORKER_CONCURRENCY`, default 5)
- [x] Development queue test endpoint (`POST /api/test/queue`, dev-only, REMOVED in 3B)
- [x] Email scheduling API (`POST /api/emails/schedule`, validation + sender check)
- [x] Email → BullMQ job relationship (`bullJobId` stored, stable `jobId = email-<id>`)
- [x] Delayed BullMQ jobs (`delay = scheduledAt - now`, no cron/setTimeout)
- [x] Worker loading Email records (missing → throw; SENT/non-SCHEDULED → safe skip)
- [x] SCHEDULED → PROCESSING transition (terminal state for this phase, no sending)
- [x] Ethereal integration
- [x] Nodemailer integration (`src/integrations/ethereal.ts`, env-driven, lazy transporter)
- [x] Worker email sending (PROCESSING → SMTP → SENT, preview URL logged)
- [x] SENT state (`sentAt` set, failure fields cleared)
- [x] SMTP retry behavior (BullMQ attempts/backoff reused; rethrow until final attempt)
- [x] FAILED state after exhausted retries (`failedAt` + `errorMessage`)
- [x] Email scheduling
- [ ] Idempotency
- [x] Redis-backed minimum send delay (per-sender Lua slot allocation)
- [x] Redis-backed hourly sender rate limit (atomic Lua quota + TTL windows)
- [x] Atomic rate-limit coordination (no GET-then-SET anywhere)
- [x] Configurable minimum delay (`MIN_DELAY_MS`, default 2000)
- [x] Configurable hourly limit (`MAX_EMAILS_PER_HOUR`, default 200)
- [x] Multi-worker-safe coordination (atomic ops, concurrency untouched)
- [x] Rate-limit rescheduling (same-job `moveToDelayed`, stays SCHEDULED, no duplicates)
- [x] Best-effort ordering (Redis arrival order, documented)
- [x] Rate-limit tests (node:test 6/6: windows/UTC/keys; Redis-integration tests env-blocked)
- [x] Rate limiting
- [x] Elasticsearch integration (`src/integrations/elasticsearch.ts`, env-driven client)
- [x] Email index (`emails`, explicit mapping, idempotent creation)
- [x] Email indexing (on create + on state changes, best-effort, never blocks sends)
- [x] Email state synchronization (PROCESSING/SENT/FAILED synced, PG authoritative)
- [x] Search API (`GET /api/emails/search`, q/status/page/limit, clean response shape)
- [x] Existing-data indexing mechanism (`npm run search:index`, counts, never on boot)
- [x] Google OAuth (`/google` + `/callback`, fetch-based, Redis state, verified-email only)
- [x] JWT authentication (`sub`-only, 7d, secret in env; no fake tokens)
- [x] Auth middleware (`requireAuth`, PG-reloaded user, typed request, 401s)
- [x] Auth routes (`/me` safe profile, `/logout` stateless success)
- [x] Schedule sender ownership (own sender or 404, no oracle)
- [x] Search ownership isolation (PG-resolved senderIds into ES terms filter)
- [x] Auth/ownership tests (18/18; DB/Google-backed flows env-blocked)
- [x] Slack OAuth (`/connect` + `/callback`, fetch-based, user-bound Redis state)
- [x] Slack connection persistence (encrypted webhook URL, upsert, userId-unique kept)
- [x] Slack status (safe shape, never the credential)
- [x] Slack disconnect/reconnect (delete + upsert, scheduling unaffected)
- [x] Hourly-limit Slack notification (worker HOURLY_LIMIT path, best-effort)
- [x] Redis notification deduplication (atomic `SET NX` per sender/hour)
- [x] Slack tests (28/28; live delivery env-blocked)
- [x] Bull Board integration (`src/queue/bull-board.ts`, existing `email-send` queue)
- [x] Bull Board route (`GET /admin/queues`, conditional on `BULL_BOARD_ENABLED`)
- [x] Bull Board access control (dev-only flag, documented; no fake RBAC)
- [x] Queue semantics unchanged (no queue/worker/rate-limit/SMTP/ES/auth file modified)
- [x] Bull Board tests (32/32; live rendering env-blocked)
- [x] Sender list API (`GET /api/senders`, caller-scoped, read-only)
- [x] Email list API (`GET /api/emails?status=&page=&limit=`, PG-authoritative)
- [x] Frontend login (`/login` → backend Google OAuth, no fake login)
- [x] Frontend auth state (`/me`, loading/auth/error, JWT in localStorage per backend flow)
- [x] App shell (sidebar nav Overview/Scheduled/Sent, header, user area, responsive)
- [x] Dashboard overview (real counts only: scheduled/sent/failed/senders)
- [x] Scheduled view (list + ES search + pagination + loading/empty/error)
- [x] Sent view (same)
- [x] Compose/schedule UI (`POST /api/emails/schedule`, validation, submitting/success/backend-error states)
- [x] Multiple sender selection (real sender IDs, empty state, no fake records)
- [x] CSV upload (parse/preview/valid-invalid/dedupe, per-recipient scheduling, no bulk API)
- [x] Start time control (server owns delay/limits — displayed, not faked)
- [x] Typed API client (centralized, no scattered fetch)
- [x] Frontend tests (23/23) + production build (7 routes)
- [x] Live Docker integration (PG/Redis/ES healthy, migrate deploy, /health 200)
- [x] Live scheduling E2E (real Ethereal SMTP + preview URLs + SENT/sentAt)
- [x] Live idempotency (SENT replay skipped, no duplicate send)
- [x] Live min-delay spacing (gaps ≈1.8/2.0s @ 2000ms, 0 errors)
- [x] Live hourly limit + reset (2 SENT, 2 rescheduled same-job, all sent at window rollover)
- [x] Live ES (reindex 15/0, search/filter/pagination, outage resilience)
- [x] Live Bull Board (jobs visible, flag off → 404)
- [x] Live restart persistence (delayed jobs + history survive, volumes kept)
- [x] Live frontend/CSV E2E via prod build + proxy
- [x] Live failure paths (Redis-down 502+FAILED; bad-SMTP retries; ES-outage 201s)
- [x] Worker reschedule hardening (`DelayedError`, reserve-once slots, queue-add timeout)
- [x] Requirements matrix + demo flow in README
- [ ] Google OAuth
- [ ] Slack OAuth
- [ ] Frontend
- [ ] Dashboard
- [ ] CSV upload
- [ ] Bull Board
- [ ] Testing
- [ ] README
- [ ] Demo video

---

# Current Implementation

### Backend

Status: PHASE 8 DONE (code + unit tests) — Bull Board observes the live `email-send` queue at `/admin/queues` (dev-only flag). Live rendering BLOCKED (no Docker).

### Database

Status: PHASE 2 DONE — 4 models + enum as specified; migration SQL generated but UNAPPLIED (no Docker in sandbox). First Docker environment must run `prisma migrate dev` before Phase 3 work.

### Queue

Status: PHASE 3A DONE (code) — `email-send` queue + worker + dev test endpoint; live processing/persistence test BLOCKED (no Docker). No email logic in worker yet.

### Phase 8 explicitly NOT implemented

Frontend, CSV upload, compose UI, dashboard UI, sender-management UX, campaigns, Google/Slack/ES changes, rate-limit redesign, cron, polling. No Phase 9 work.

### Frontend

Status: PHASE 9 DONE (code + 23 unit tests + production build) — login, shell, overview, scheduled/sent, compose + CSV. Live OAuth/schedule/worker flows BLOCKED (no Docker/Google creds).

---

# Known Issues

- No Docker in this sandbox, so `docker compose up -d` and live PG/Redis "up" verification are untested. Next environment with Docker: run compose, `curl localhost:4000/health`, expect `{"ok":true,...}`.
- `apps/backend/package.json` lists `elasticsearch`/`nodemailer`/`jsonwebtoken` as used now (wired in Phases 5/3C/6); remaining unused: `bull-board/*`. Trim or keep when Phase 8 lands.

# Future Infrastructure Requirement (BullMQ phase)

- DONE in Phase 3A (compose): `command: redis-server --appendonly yes` + `redisdata` volume. Live persistence test still pending Docker.

---

# Next Task

Phase 10 — Integration testing, hardening, demo readiness. Prerequisite Docker run: full Phase 9 runtime list (OAuth → schedule → worker → sent, CSV bulk, search) first. Do not start Phase 10 work in this phase.

---

# Important Rules

1. Do not implement future phases prematurely.
2. Do not modify completed functionality without a reason.
3. Keep implementation simple.
4. Follow REQUIREMENTS.md.
5. Update this file after completing meaningful work.
6. Record important architectural decisions here.
7. Never claim something is implemented unless it actually works.