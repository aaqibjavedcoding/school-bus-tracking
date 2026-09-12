# Deployment

## Overview

This document describes how to deploy the School Bus Tracking platform.

**No paid service/provider is included in this phase.**

## Prerequisites

- Node.js >= 22.0.0 (pinned via `.nvmrc`; CI builds on the same major)
- PostgreSQL 16 with PostGIS 3.4 (parity image: `postgis/postgis:16-3.4`)
- npm or yarn

## Environment Variables

### Required

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-secure-password
DB_NAME=school_bus_tracking

# JWT
JWT_SECRET=your-very-long-random-secret-at-least-32-chars

# CORS
CORS_ORIGIN=https://your-domain.com
```

### Optional

```bash
# Application
NODE_ENV=production
PORT=3001
API_PREFIX=api/v1

# Database
DB_SSL=true
DB_POOL_MAX=20
DB_POOL_MIN=2
DB_LOGGING=false

# Security
SECURITY_IS_PRODUCTION=true
SECURITY_HEADERS_ENABLED=true
SECURITY_HSTS_MAX_AGE=15552000
# CSRF is on by default; these are the names `security.config.ts` actually reads.
CSRF_ENABLED=true
CSRF_COOKIE_NAME=csrf_token
CSRF_HEADER_NAME=x-csrf-token
# Browser origins allowed to send credentialed requests (no wildcard in production).
CORS_ORIGIN=https://app.example.com

# Rate Limiting
RATE_LIMIT_AUTH_LOGIN_LIMIT=5
RATE_LIMIT_AUTH_REFRESH_LIMIT=10
RATE_LIMIT_READ_HEAVY_LIMIT=100

# Retention
LOCATION_RETENTION_DAYS=90
NOTIFICATION_RETENTION_DAYS=180
REFRESH_TOKEN_RETENTION_DAYS=30
AUDIT_LOG_RETENTION_DAYS=365
EMERGENCY_RETENTION_DAYS=730
IDEMPOTENCY_KEY_RETENTION_DAYS=7

# Subscription
SUBSCRIPTION_GRACE_PERIOD_DAYS=7
```

### Content-Security-Policy and map tiles

The web app renders its live-tracking map with OpenStreetMap tiles. The CSP in
`web/security-headers.js` already allows exactly one tile origin by default —
`https://tile.openstreetmap.org` — and the map (`web/src/features/map/MapViewInner.tsx`)
is pinned to that host, so no extra configuration is needed for the map to work
in production. If a deployment adds further image sources (e.g. school avatars
on a CDN), extend `img-src` with `CSP_EXTRA_IMG_SRC=https://cdn.example.com`
(comma-separated). Do not use a wildcard. Similarly, `CSP_EXTRA_CONNECT_SRC`
extends `connect-src` for extra API/websocket origins. All other security
headers (HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`) are always emitted; HSTS only in
production.

## Build

```bash
# Install dependencies
npm ci

# Build packages
npm run build:packages

# Build apps
npm run build
```

## Database Setup

```bash
# Run migrations
cd web
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

> **Seeded ids must be valid v4 UUIDs.** Every primary key in this system is a
> v4 UUID (`BaseModel` declares `@IsUUID(4)` with a `UUIDV4` default, the DTOs
> validate ids with `@IsUUID('4')`, and the route handlers re-check path
> segments with `parseUuidParam()`). PostgreSQL's `uuid` type only checks that
> a value is 32 hex digits, so a seeder can write ids the API then rejects —
> which is how a demo tenant once ended up returning
> `Validation failed (uuid is expected)` from Super Admin → Schools →
> "Manage data". `npm run smoke:seed-uuids` dry-runs the demo seeder without a
> database and fails if any generated id or foreign key breaks that contract.
> If a database was seeded before this was fixed, re-running `npm run db:seed`
> replaces the affected rows.

## Start

```bash
# Production (serves the web UI and the /api/v1 API from one process, PORT default 3001)
cd web
npm run start

# Development
npm run dev
```

Both run the same custom server entrypoint (`web/server.js`), which bootstraps the
database, mounts the API and Socket.IO under `/api/v1`, and hands everything else
to Next.js. Build first with `npm run build` (compiles the server API into
`web/dist` and the App Router bundle into `web/.next`).

### Single-instance architecture (deployment constraint)

The supported deployment is **one API server process against one PostgreSQL**.
Three subsystems are process-local by design and must move together before any
horizontal scaling (see `docs/security.md` → "Rate limiting — deployment
assumptions" for the full checklist):

1. **Rate limiting** — counters live in the process's memory; N instances
   multiply the effective limits and restarting resets the windows.
2. **Socket.IO** — rooms, broadcasts and the session-revalidation sweep are
   in-process; realtime needs a shared adapter (e.g. Redis) for N instances.
3. **Background workers** — the retention scheduler runs inside the server
   process (safe to replicate: the PostgreSQL advisory lock makes every extra
   instance's pass a skip, but run exactly one instance for tidy schedules).

### Background workers

The server starts two in-process background loops after boot; both are
configuration-gated and neither can crash the server:

| Worker                         | What it does                                                                                                                                                                                                         | Knobs                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Retention worker               | Deletes GPS locations / notifications / refresh tokens / audit logs / resolved emergencies / expired idempotency keys past their policy age (`docs/data-retention.md`)                                               | `RETENTION_ENABLED`, `RETENTION_INTERVAL_MS` (default 6 h), `RETENTION_INITIAL_DELAY_MS` (default 30 s), `*_RETENTION_DAYS` |
| WebSocket session revalidation | Every `WEBSOCKET_SESSION_REVALIDATION_INTERVAL_MS` (default 5 min) disconnects live sockets whose access token expired, whose account or school was deactivated; clients reconnect and re-authenticate transparently | `WEBSOCKET_SESSION_REVALIDATION_ENABLED`, `..._INTERVAL_MS`                                                                 |

### Graceful shutdown

`server.js` handles `SIGTERM`/`SIGINT` (container stop, `kill`, Ctrl-C):

1. stops the retention scheduler and the socket revalidation sweep,
2. closes the Socket.IO server (disconnects clients, which then reconnect to
   the remaining instance in future multi-instance setups),
3. stops the HTTP listener and idle keep-alive connections,
4. closes the database pool,

with a 10 s force-exit bound so a stuck connection can never hang a container
stop. Orchestrators should rely on this and allow the default grace period
(e.g. Docker's 10 s `stop_grace_period`) — the server normally exits well
inside it.

> **`web/dist` must match `web/src/server`.** The App Router route handlers
> `require()` the compiled server tree at runtime, so a `dist` that predates the
> sources (a `git pull` that added an endpoint, a branch switch, an edit without
> `npm run build:server`) does _not_ fail at boot — the server starts, login
> works, and the first request into a module that has no compiled output throws
> `Cannot find module '…/dist/api/<module>'` inside the handler. Next then
> answers with its generic 500 page instead of the JSON envelope, which is how
> the school-admin dashboard once rendered a raw HTML/JSON error in place of
> the UI. `server.js` now verifies the tree on start-up
> (`web/server-build-check.js`): in development a missing, incomplete or stale
> `dist` is rebuilt automatically; in production the server refuses to start
> and lists the affected modules. `SKIP_SERVER_BUILD_CHECK=true` disables the
> check for images that ship `dist` without matching source mtimes.

## Docker Compose (Development)

```bash
cd infrastructure
docker compose up -d
```

## Production container deployment (single instance)

The minimum production configuration for the supported topology (one app
process + one PostgreSQL, no paid managed services) lives in
`infrastructure/`:

| File                      | Purpose                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`              | Multi-stage production image (Node 22). Builds packages + web, runs the same `web/server.js` entrypoint unprivileged. |
| `docker-compose.prod.yml` | App, one-shot `migrate`, PostgreSQL 16 + PostGIS 3.4 with persistent volumes.                                         |
| `.env.production.example` | Every required environment value with placeholders; no secrets.                                                       |

The build context is the repository root (the image spans npm workspaces):

```bash
cd infrastructure
cp .env.production.example .env.production
# Edit .env.production: CORS_ORIGIN, DB_PASSWORD, JWT_SECRET at minimum.
# Generate the JWT secret with: openssl rand -hex 64

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

What the compose stack provides and why:

- **Migrations first.** A `migrate` container runs `npm run db:migrate` against
  the healthy database and exits; `app` starts only after it completes
  successfully. Seeding remains optional
  (`docker compose --env-file .env.production -f docker-compose.prod.yml run --rm app npm run db:seed`).
- **TLS to the database.** The production startup guard requires `DB_SSL=true`.
  A one-shot `db-tls-init` container generates a self-signed certificate into
  a volume (the key is never committed) and PostgreSQL enables TLS on the
  internal Docker network. The app requires TLS without pinning the internal CA.
- **Browser TLS terminates in front of the app.** The app port is published on
  `127.0.0.1:${APP_PORT:-3001}` only. Put a reverse proxy (Caddy/nginx, or the
  host's edge) in front for HTTPS; plain HTTP cannot sustain sessions because
  the refresh cookie is `Secure`/`SameSite=None`.
- **Persistence.** Named volumes hold the database (`db_data`), the internal
  TLS certificate (`db_certs`) and local document uploads
  (`app_documents` → `/app/web/.document-storage`). Document storage stays on
  the local filesystem in the single-instance topology; object storage is a
  later phase and would be required before scaling out.
- **Health checks.** The image defines a container health check against
  `/api/v1/health`; the database uses `pg_isready`.
- **No secrets in the image or repository.** Everything secret arrives via
  `.env.production` (git-ignored) or the eventual orchestrator's secret store.
  The FCM service-account JSON is supplied the same way at deployment time;
  leaving it empty keeps the no-op push provider and is a valid configuration.

Nothing here is deployed automatically — these files only prepare the
single-instance deployment. Redis, horizontal scaling, object storage,
monitoring and backups remain out of scope for this phase.

### Building the image without Compose

```bash
docker build -f infrastructure/Dockerfile -t school-bus-tracking:latest .
```

The runtime image contains the compiled `web/dist` server tree, the `web/.next`
production bundle and the TypeScript migrations (run through `ts-node`, same as
`npm run db:migrate` on a host install). The startup build check refuses to
run if the compiled tree is incomplete.

## Health Checks

- Liveness: `GET /api/v1/health`
- Readiness: `GET /api/v1/health/ready`

## Production Checklist

- [ ] Strong JWT secret configured
- [ ] CORS allowlist configured for production domains
- [ ] Database SSL enabled
- [ ] Security headers enabled
- [ ] HSTS enabled
- [ ] CSRF protection enabled
- [ ] Rate limiting configured
- [ ] Retention policies configured
- [ ] Backup strategy in place
- [ ] Monitoring configured
- [ ] Logging configured
- [ ] Health checks configured
- [ ] Environment variables secured
- [ ] No secrets in code or version control

## Monitoring

### Health Endpoints

- `GET /api/v1/health` — Process liveness
- `GET /api/v1/health/ready` — Service readiness

### Logs

Production logs are JSON structured:

```json
{
  "timestamp": "2026-09-01T12:00:00.000Z",
  "level": "info",
  "request_id": "uuid",
  "method": "GET",
  "path": "/api/v1/students",
  "status": 200,
  "duration_ms": 45,
  "user_id": "uuid",
  "school_id": "uuid"
}
```

### Key Metrics

- Request latency (p50, p95, p99)
- Error rate (4xx, 5xx)
- Database connection pool usage
- Active WebSocket connections
- GPS location updates/second
- Notification delivery rate
