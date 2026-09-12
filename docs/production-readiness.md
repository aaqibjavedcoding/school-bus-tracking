# Production Readiness

## Overview

This document tracks the production-readiness of the platform. Status
categories are kept deliberately separate so nobody mistakes _code that
exists_ for _behaviour that runs in a deployed server_:

| Category                             | Meaning                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Implemented**                      | The code exists and is exercised by tests.                                                                             |
| **Tested**                           | Automated tests prove the behaviour (unit / integration on real PostgreSQL / E2E over real HTTP).                      |
| **Operationally wired**              | The feature runs automatically in the deployed server lifecycle (`server.js`) with shutdown handling — no manual step. |
| **Deferred**                         | Intentionally not built in this phase; the seam/plan exists.                                                           |
| **Requires external infrastructure** | Cannot be completed without an external service or paid provider (prohibited this phase).                              |
| **Not implemented**                  | No code, no plan yet.                                                                                                  |

**No paid service/provider is included in this phase.**

## At a glance

| Capability                                                                                                   | Implemented                                                                | Tested                                          | Operationally wired                                                                   |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Audit logging                                                                                                | ✅                                                                         | ✅                                              | ✅ (every mutation path)                                                              |
| Request ID + structured logging                                                                              | ✅                                                                         | ✅                                              | ✅ (`/api/*` chain)                                                                   |
| Health / readiness                                                                                           | ✅                                                                         | ✅ unit + E2E                                   | ✅                                                                                    |
| Idempotency for critical operations                                                                          | ✅                                                                         | ✅                                              | ✅                                                                                    |
| Data retention worker                                                                                        | ✅                                                                         | ✅ unit + real-PostgreSQL integration           | ✅ (scheduled in `server.js`, stopped on shutdown)                                    |
| WebSocket session revalidation                                                                               | ✅                                                                         | ✅ unit                                         | ✅ (started with the gateways in `wireRealtimeGateways`)                              |
| Rate limiting (single instance)                                                                              | ✅                                                                         | ✅ unit + E2E                                   | ✅ (global guard)                                                                     |
| Realtime (live tracking / notifications / emergencies)                                                       | ✅                                                                         | ✅                                              | ✅                                                                                    |
| CORS / security headers / CSP / request-id                                                                   | ✅                                                                         | ✅ unit + E2E over the production chain         | ✅                                                                                    |
| Push / Email / SMS providers                                                                                 | ✅ (no-op abstractions)                                                    | ✅                                              | ❌ requires external provider                                                         |
| Document storage                                                                                             | ✅ (local filesystem)                                                      | ✅                                              | ❌ requires object storage in production                                              |
| Backup/restore                                                                                               | ✅ (local dev script)                                                      | manual                                          | ❌ requires offsite infrastructure                                                    |
| CI (lint, typechecks, unit tests, DB integration/E2E on PostgreSQL 16 + PostGIS 3.4, builds, Android export) | ✅ (`.github/workflows/ci.yml`)                                            | ✅ all gates run on every push and PR to `main` | ✅ each gate is a standalone job, ready to become a required check on `main`          |
| Production container (single instance)                                                                       | ✅ (`infrastructure/Dockerfile`, `infrastructure/docker-compose.prod.yml`) | ✅ image build verified in CI                   | ✅ operator brings it up at deploy time (not deployed yet — see `docs/deployment.md`) |
| Horizontal scaling                                                                                           | ❌ single-instance by design                                               | —                                               | ❌ see limitations                                                                    |

## Implemented and operationally wired

### 1. Audit Logging

- **Location**: `web/src/server/modules/audit/`
- **Coverage**: School lifecycle, student/guardian/staff/bus/route/trip/document/emergency operations, auth events, trip status transitions (`{from, to}` metadata)
- **Storage**: PostgreSQL `audit_logs` table (append-only; retention-managed)
- **UI**: Super Admin audit log screen at `/admin/audit-logs`
- **Status**: Implemented, tested, wired into every mutation path.

### 2. Request ID + Structured Logging

- **Location**: `web/src/server/common/middleware/request-id.middleware.ts`, `web/src/server/common/interceptors/structured-logging.interceptor.ts`
- Every API request gets a correlation ID (client-supplied or server-generated UUID), echoed in `x-request-id` and stamped into logs/audit
- Production logs are JSON with request_id, method, path, status, duration, user_id, school_id; secrets/tokens are never logged
- **Status**: Implemented, tested (unit + E2E header echo), wired on the `/api/*` chain.

### 3. Health / Readiness

- **Endpoints**: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (readiness, 503 with per-dependency checks when not ready)
- **Status**: Implemented; unit-tested; E2E-tested unauthenticated over the production middleware chain.

### 4. Idempotency for Critical Operations

- **Location**: `web/src/server/common/idempotency/`
- **Operations**: GPS location ingest, trip status transitions, trip cancellation
- **Mechanism**: client-generated `x-idempotency-key` header; results stored in PostgreSQL `idempotency_keys` with a TTL; tenant/user/endpoint-scoped
- **Schema fix (this phase)**: the `idempotency_keys` table was missing the `updated_at`/`deleted_at` columns the shared `BaseModel` maps, so **every idempotent write failed** against a migrated database. Migration `20260908120000-add-updated-at-to-idempotency-keys.ts` adds them (additive, nullable, never written by the app), mirroring the earlier audit-logs fix.
- **Cleanup**: expired keys are deleted by the retention worker (below).
- **Status**: Implemented, tested (unit + real-PostgreSQL retention coverage), wired into the route runtime.

### 5. Data Retention — scheduled worker

- **Location**: `web/src/server/workers/` (`retention.worker.ts`, `retention.scheduler.ts`)
- **What it does**: deletes GPS trip locations, notifications, expired refresh tokens, audit logs, resolved/cancelled emergency events and expired idempotency keys past their configured ages
- **Wiring**: `server.js` starts exactly one scheduler per process after the database bootstrap (guarded against duplicate starts) and stops it during graceful shutdown; failed passes are logged and retried, never fatal
- **Concurrency**: PostgreSQL **transaction-scoped advisory lock** (`pg_try_advisory_xact_lock`) — with multiple processes, losers skip the pass; the lock is released by the transaction itself (the previous session-level lock could leak across pool connections)
- **Configuration**: `LOCATION_RETENTION_DAYS` (90), `NOTIFICATION_RETENTION_DAYS` (180), `REFRESH_TOKEN_RETENTION_DAYS` (30), `AUDIT_LOG_RETENTION_DAYS` (365), `EMERGENCY_RETENTION_DAYS` (730), `IDEMPOTENCY_KEY_RETENTION_DAYS` (7); cadence via `RETENTION_ENABLED`, `RETENTION_INTERVAL_MS` (6 h), `RETENTION_INITIAL_DELAY_MS` (30 s)
- **Status**: Implemented, unit-tested (lock/cutoff/rollback), integration-tested on real PostgreSQL (deletes the right rows, keeps recent/open rows, idempotent, skips under a foreign lock), **operationally wired**.

### 6. WebSocket Session Revalidation

- **Location**: `web/src/server/common/websocket/websocket-session-revalidation.ts`, wired in `web/src/server/realtime/index.ts`
- **What it does**: every `WEBSOCKET_SESSION_REVALIDATION_INTERVAL_MS` (default 5 min) sweeps the three gateway namespaces (`/live-tracking`, `/notifications`, `/emergencies`) and force-disconnects sockets whose access token expired since the handshake (`token_exp` captured at handshake — no DB cost), whose account was deactivated, or whose school was deactivated; the socket receives `session:revoked` with the reason first
- **DB cost**: batched (one query per distinct tenant, one for all connected users) at a minutes-wide interval — never per-event
- **Failure semantics**: database errors fail the pass safe (nothing disconnected), are logged, and the schedule continues
- **Re-authentication**: clients (web + mobile) reconnect automatically and re-run their `auth` callback with the current token, so live sessions resume and revoked ones are refused at the handshake — exactly like HTTP
- **Handshake authentication is unchanged** (full JWT + tenant-state verification per connect)
- **Status**: Implemented, unit-tested, **operationally wired** with the gateway wiring (idempotent, single start per process).

### 7. Rate Limiting (single-instance)

- **Location**: `web/src/server/common/rate-limit/`
- **Policies**: `auth_login` (per-IP **and** per school+email identity), `auth_refresh`, `auth_logout`, `password_reset`, `sos_create`, `attendance_write`, `location_read`, `read_heavy`, `device_register`, `data_import`, `data_export`, `report_read` — every limit/window env-tunable
- **Store**: process-local bounded memory store. Correct for the supported single-instance deployment; `RATE_LIMIT_STORE=redis` **fails fast** (no silent degradation). See `docs/security.md` for the exact scaling contract and what must change first.
- **Status**: Implemented, unit-tested (windows, identity buckets, 429 envelope, fail-fast store factory, restart semantics) and E2E-tested over real HTTP.

### 8. API middleware chain — one implementation for production and tests

- **Location**: `web/src/server/http/api-middleware-chain.ts`
- **Chain**: CORS → compression → security headers → cookie parsing → request-id, scoped to `/api/v1/*`
- `web/server.js` and the E2E harness (`src/server/http/test-server.ts`) both mount **this same chain**, so E2E suites exercise the exact production pipeline: allowlisted-origin echo, preflight, `nosniff`, JSON-only CSP, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, gzip negotiation (`COMPRESSION_ENABLED`, `COMPRESSION_THRESHOLD_BYTES` — an explicit `0` now compresses everything), request-id stamping/echo, cookie parsing and the 401/error envelopes.
- **Layering note (production)**: on the real server, Next.js additionally applies `next.config.js` `headers()` (`/:path*`, incl. `/api/v1/*`) when it serves the response — the web-app CSP and production HSTS therefore ride on API responses too, layered over the chain's values (the E2E harness serves the API directly, so it asserts the chain's own strict JSON CSP and the HSTS-off-outside-production rule). Both layers harden; neither weakens the other.
- **Status**: Implemented, E2E-tested (CORS/CSRF/headers/compression/request-id suites), wired.

### 9. Graceful shutdown

- `web/server.js` handles `SIGTERM`/`SIGINT`: stops the retention scheduler and the revalidation sweep, closes Socket.IO, stops the HTTP listener, closes the database pool — bounded by a 10 s force-exit.
- **Status**: Implemented and wired (shutdown order verified by code review + the scheduler/revalidation stop semantics are unit-tested).

## Implemented — NOT operationally complete (requires external infrastructure)

### Notification providers (push / email / SMS)

- **Status**: abstractions + no-op development providers implemented and unit-tested. Real delivery requires external providers (FCM/APNs, SES/SendGrid, Twilio) — **prohibited this phase**.

### Document storage

- **Status**: abstraction + local-filesystem provider implemented and tested. Production requires object storage (S3/GCS/Azure) — **prohibited this phase**. Local disk is NOT a production storage solution.

### Backup/restore

- **Status**: local Docker-based backup/restore script implemented (`scripts/backup-restore.sh`). Production requires encrypted offsite backups — **not solvable in this phase**.

## Deferred (explicit)

| Item                                              | Why deferred                                                                      | Where the seam is                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Distributed rate-limit store                      | Single instance is the supported deployment; no paid/external services this phase | `RateLimitStore` interface + `RATE_LIMIT_STORE` fail-fast factory |
| Redis adapter for Socket.IO                       | Same reason                                                                       | gateway wiring in `realtime/index.ts`                             |
| Retention CLI / manual Super Admin trigger        | In-process schedule covers the need                                               | `workers/retention.scheduler.ts`                                  |
| GPS table partitioning / archival to cold storage | Volume not there yet                                                              | `docs/data-retention.md`                                          |
| Mobile E2E on device farm                         | Requires external service                                                         | `docs/mobile-operations.md`                                       |

## Requires future external provider (prohibited this phase)

- Push notifications (Firebase, APNs, …)
- Email notifications (SendGrid, SES, …)
- SMS notifications (Twilio, …)
- Object storage (S3, GCS, Azure Blob, …)
- Encrypted offsite backup infrastructure
- Managed Redis (only if horizontal scaling is ever chosen — see limitations)

## Production limitations (current, deliberate)

1. **Single instance only.** Rate limiting, Socket.IO and the retention
   scheduler are process-local. Effective rate limits scale ×N behind a load
   balancer; restarting resets brute-force windows. The full
   move-to-multi-instance checklist lives in `docs/security.md`.
2. **PostgreSQL is required.** Every subsystem (auth, idempotency, audit,
   retention, subscriptions, plan limits) is backed by PostgreSQL; there is
   no in-memory fallback for production (`DB_AUTO_CONNECT=false` is a
   test/smoke-only escape hatch and is ignored for real server bootstraps).
3. **Notifications do not leave the server.** Push/email/SMS providers are
   no-ops; `notifications` rows are written and readable in-app only.
4. **Documents live on local disk.** Container/volume loss loses uploaded
   documents; attach object storage before production use.
5. **Backups are local.** `scripts/backup-restore.sh` targets a Docker volume;
   production needs scheduled, encrypted, offsite copies plus restore drills
   (`docs/backup-restore.md`).

## Test coverage map

- **Unit** (`npm run test:server`, `npm run test:web`): services, guards, DTOs, middleware, rate limiter, retention worker/scheduler, session revalidation, gateways, web helpers.
- **Integration** (`npm run test:integration`, real PostgreSQL): migrations round-trip, tenant isolation, plan limits, subscriptions, run conflicts, attendance, **retention worker end-to-end SQL**.
- **E2E** (`npm run test:e2e`, real HTTP over the production middleware chain): browser security (CORS/CSRF/headers/compression/request-id/health/auth), cross-tenant access, multi-school security, rate limiting, assisted management.
- **Mobile**: unit specs via `npm --prefix mobile test`.

## Production Deployment Requirements

1. Configure all environment variables (see `web/.env.example`)
2. Review retention policies + worker cadence (`docs/data-retention.md`)
3. Set up encrypted offsite backups
4. Configure a proper object storage provider for documents
5. Configure push/email/SMS providers when available
6. Set up monitoring and alerting (health/readiness endpoints are ready)
7. Configure the CORS allowlist for production domains
8. Set strong JWT secrets; enable SSL for database connections
9. Keep the deployment **single-instance** until the horizontal-scaling checklist in `docs/security.md` is executed
