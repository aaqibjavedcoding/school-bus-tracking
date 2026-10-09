# Deployment

## Overview

This document describes how to deploy the KidBus platform.

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

# Email delivery (see "Email delivery and password reset" below)
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@yourschool.edu
SMTP_PASS=app-password-not-the-account-password
EMAIL_FROM=KidBus <no-reply@yourschool.edu>

# Absolute origin for links the server emails out. Defaults to the first
# CORS_ORIGIN entry; set it when a proxy's public URL differs.
APP_URL=https://app.example.com

# Password reset (self-service, SCHOOL_ADMIN only)
PASSWORD_RESET_TTL_MS=2700000
RATE_LIMIT_PASSWORD_RESET_PUBLIC_LIMIT=5
RATE_LIMIT_PASSWORD_RESET_PUBLIC_WINDOW_MS=900000
RATE_LIMIT_PASSWORD_RESET_PUBLIC_IDENTITY_LIMIT=3
RATE_LIMIT_PASSWORD_RESET_PUBLIC_IDENTITY_WINDOW_MS=3600000

# Marketing communications (Super Admin; see docs/marketing-communications.md)
# Where OPERATIONAL marketing mail goes: test sends, new demo lead
# notifications, delivery failure alerts. Campaign emails NEVER go here —
# they go only to the server-side school audience snapshot.
MARKETING_ADMIN_EMAILS=zeromilesystems@gmail.com
# Closed allowlist a template test send may target.
MARKETING_TEST_RECIPIENTS=zeromilesystems@gmail.com
# Background campaign delivery worker (runs inside the API process).
MARKETING_WORKER_ENABLED=true
# Public "Request a Demo" form limits (per IP / per hashed email identity).
RATE_LIMIT_MARKETING_DEMO_REQUEST_LIMIT=5
RATE_LIMIT_MARKETING_DEMO_REQUEST_WINDOW_MS=900000
RATE_LIMIT_DEMO_REQUEST_IDENTITY_LIMIT=3
RATE_LIMIT_DEMO_REQUEST_IDENTITY_WINDOW_MS=3600000
# Reply-To of operational and campaign mail.
EMAIL_REPLY_TO=zeromilesystems@gmail.com
# Hardening 5B secrets — set these ONLY in Render → Environment.
# Empty MARKETING_PROVIDER_WEBHOOK_SECRET keeps the signed provider
# email-event endpoint closed (which is correct on Gmail SMTP, because
# nothing signs events there). Empty MARKETING_ATTRIBUTION_SECRET disables
# signed attribution cookies; legacy digest cookies still resolve.
MARKETING_PROVIDER_WEBHOOK_SECRET=
MARKETING_ATTRIBUTION_SECRET=
# Marketing retention windows (same worker pass as the policies above).
MARKETING_EVENT_RETENTION_DAYS=365
MARKETING_LEAD_RETENTION_DAYS=730
MARKETING_RECIPIENT_PII_RETENTION_DAYS=180
MARKETING_NOTIFICATION_JOB_RETENTION_DAYS=90
MARKETING_PROVIDER_EVENT_RETENTION_DAYS=180
```

### Email delivery and password reset

School administrators reset their own password from `/forgot-password`, and
the link that makes that possible arrives by email. Password reset and the
Super Admin marketing rail (campaigns, test sends, demo lead notifications —
see below) are the only mail this system sends, and they are the reason the
SMTP settings above exist.

**Without configuration nothing breaks and no mail is sent.** The provider
factory (`web/src/server/modules/notifications/providers/email-provider.factory.ts`)
returns `NoOpEmailProvider` unless `EMAIL_PROVIDER=smtp` **and** all five of
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` are
present. The no-op logs what it would have sent and reports success, so local
development, `npm test` and CI need no relay and no credentials. A deployment
that sets `EMAIL_PROVIDER=smtp` but leaves a variable blank gets a warning —
an **error** under `NODE_ENV=production` — naming the missing keys, and still
falls back to the no-op rather than failing at send time. Values are never
logged.

Delivery uses [nodemailer](https://nodemailer.com) over plain SMTP, so any
ordinary mail server works: a school's Google Workspace or Microsoft 365
relay, a self-hosted Postfix, an ISP smarthost. There is no paid API and no
vendor SDK. Use an **app password**, never the mailbox account's own password,
and give the sending account no other privileges.

`SMTP_SECURE` is optional: it defaults to `true` on port 465 (implicit TLS)
and `false` otherwise (port 587, STARTTLS upgrade), which is what almost every
relay expects.

Operational notes:

- **Link lifetime** — `PASSWORD_RESET_TTL_MS` is *clamped to 30–60 minutes*.
  A value outside that band is silently pulled into it rather than rejected,
  so a typo degrades to a safe lifetime instead of taking password reset down.
  The email always states the number the server actually enforces.
- **APP_URL** — the emailed link is `{APP_URL}/reset-password?token=…`. When
  unset it falls back to the first `CORS_ORIGIN` entry, which is already "the
  origin a browser reaches this app on"; set it explicitly when the app sits
  behind a proxy whose public URL differs.
- **Rate limits** — the two public endpoints use their own
  `password_reset_public` policy, deliberately stricter than the
  admin-initiated `password_reset` one because they are unauthenticated: 5
  requests per 15 minutes per IP *and* 3 per hour per (school + email), so a
  single mailbox cannot be flooded from a botnet.
- **Enumeration** — `POST /api/v1/auth/forgot-password` always returns the
  same message, whether or not the address matched an account. Do not
  "improve" it with a specific one; it is asserted byte-for-byte by
  `password-reset.service.spec.ts`.
- **If reset emails are not arriving**, check the logs for
  `EmailProviderSelection` at boot: it names the provider it selected and, if
  SMTP was requested but rejected, exactly which variables were missing.

### Marketing email and demo leads

The Super Admin marketing rail (`docs/marketing-communications.md` is the
full reference) shares the same SMTP provider abstraction. Deployment notes
specific to it:

- **Configuration for the current setup** (Gmail with an app password):
  `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
  `SMTP_SECURE=false`, `SMTP_USER=zeromilesystems@gmail.com`, `SMTP_PASS`
  set to an **app password** stored only in the host's environment settings
  (Render → Environment), and
  `EMAIL_FROM=Zero Mile Systems <zeromilesystems@gmail.com>`. Never commit
  real credentials to the repository or `.env.example`; the server never
  logs them.
- **Routing invariants**: campaign emails go only to the recipients frozen
  in the campaign's audience snapshot (selected schools); operational mail —
  template test sends (restricted to `MARKETING_TEST_RECIPIENTS`), new demo
  lead notifications and failure alerts — goes only to
  `MARKETING_ADMIN_EMAILS`. Neither list is ever mixed into the other, and
  no endpoint accepts a recipient address from a browser.
- **Worker on Render**: the delivery worker runs inside the API service
  process (`MARKETING_WORKER_ENABLED=true`) — no separate Render worker
  service is required. If you scale to multiple instances the advisory lock
  keeps sweeps single-flight, and leases recover recipients from a killed
  container.
- **`APP_URL`** must be the public origin (e.g. the Render URL or custom
  domain). It builds the tracked click redirects, unsubscribe links and the
  demo-lead console deep links — a wrong value here produces emails pointing
  at localhost.
- **Deliverability**: publish SPF, DKIM and DMARC for the sending domain,
  keep the visible `Reply-To`, and warm the sender up — the worker's
  per-minute ceiling (`MARKETING_RATE_PER_MINUTE`) exists so a new sender
  ramps gradually instead of bursting. Every campaign email carries
  `List-Unsubscribe`/`List-Unsubscribe-Post`; do not strip them at a relay.
- **Demo requests** arrive on the public landing page form. Since Hardening
  5B the lead **and** its admin-notification job are written in one
  transaction and the request returns without waiting for SMTP. The
  notification is drained by the same worker tick as campaign delivery
  (notifications first), with `FOR UPDATE SKIP LOCKED`, leases and bounded
  retries — a redeploy mid-send delays a notification instead of losing it,
  and two instances never send it twice. Leads stay visible at
  `/admin/marketing/leads`; every attempt is recorded on the lead timeline
  as `ADMIN_NOTIFIED` or `ADMIN_NOTIFY_FAILED`.
- **Bounces and complaints — read this before promising anything.** Plain
  Gmail SMTP gives the application **no webhook** for delayed bounces or
  spam complaints; they arrive as messages in the sending mailbox. What the
  platform handles automatically is an *immediate* SMTP rejection. The
  working feedback loop is the Super Admin console at
  `/admin/marketing/suppressions`: record the address, and every not-yet-sent
  recipient row for it is suppressed across all campaigns. A signed ingest
  endpoint (`POST /api/v1/integrations/marketing/email-events`, HMAC +
  timestamp + replay protection) is ready for the day a real event source
  exists; it stays closed while `MARKETING_PROVIDER_WEBHOOK_SECRET` is empty.
- **Sender domain caveat**: this deployment sends from a Gmail mailbox, so
  SPF, DKIM and DMARC for `gmail.com` are Google's records and cannot be
  configured here — deliverability rests on Gmail's reputation and on
  sending gently. Do **not** invent a custom-domain sender such as
  `updates@yourdomain.com`: an unverified `From` fails authentication and
  lands in spam. Set `EMAIL_REPLY_TO` so replies reach a monitored mailbox.
- **Marketing secrets** (`MARKETING_PROVIDER_WEBHOOK_SECRET`,
  `MARKETING_ATTRIBUTION_SECRET`, `SMTP_PASS`) belong only in Render →
  Environment. They are never committed, never logged and never returned by
  an endpoint. Both marketing secrets are read per request, so rotating one
  needs no restart (rotating the attribution key invalidates outstanding
  `zms_ref` cookies, which only costs attribution on in-flight clicks).

### Content-Security-Policy and map tiles

The web app renders its live-tracking map with **MapLibre GL JS** (`maplibre-gl`
v5, open source) over **OpenFreeMap's public instance**
(`https://tiles.openfreemap.org/styles/bright`, OpenStreetMap data, no key, no
billing). The CSP in `web/security-headers.js` already allows exactly one tile
origin by default — `https://tiles.openfreemap.org` — in **both** `img-src` and
`connect-src` (the engine fetches style JSON, vector tiles, glyphs and sprites
via `connect-src`) and `worker-src blob:` for the MapLibre worker. The map
(`web/src/features/map/MapViewInner.tsx`) is pinned to that host through
`web/src/features/map/map-style.ts` (`resolveMapStyleUrl` reads
`NEXT_PUBLIC_MAP_STYLE_URL` when set and https, else the public default), so no
extra configuration is needed for the map to work in production. To self-host
OpenFreeMap later, set `NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.example.com/styles/bright`
(https-only, warn-once fallback). If a deployment adds further image sources
(e.g. school avatars on a CDN), extend `img-src` with
`CSP_EXTRA_IMG_SRC=https://cdn.example.com` (comma-separated). Do not use a
wildcard. Similarly, `CSP_EXTRA_CONNECT_SRC` extends `connect-src` for extra
API/websocket origins. All other security headers (HSTS,
`X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`) are always emitted; HSTS only in production.

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

**Production databases are never seeded.** Production deploys apply schema migrations only:

```bash
cd web
npm run db:migrate
```

Demo and dummy seeders are development/test fixtures. They refuse to run in production and require
`ALLOW_DEMO_SEED=1` for every run. To seed a local database, first set `SUPER_ADMIN_EMAIL` and
`SUPER_ADMIN_PASSWORD` in the local environment; the password must contain at least 16 characters
and must not equal the email. Then run:

```bash
cd web
ALLOW_DEMO_SEED=1 npm run db:seed
```

> **Seeded ids must be valid v4 UUIDs.** Every primary key in this system is a
> v4 UUID (`BaseModel` declares `@IsUUID(4)` with a `UUIDV4` default, the DTOs
> validate ids with `@IsUUID('4')`, and the route handlers re-check path
> segments with `parseUuidParam()`). PostgreSQL's `uuid` column type only checks that
> a value is 32 hex digits, so a seeder can write ids the API then rejects.
> `npm run smoke:seed-uuids` dry-runs the demo seeder without a database and
> fails if any generated id or foreign key breaks that contract. If a local
> database was seeded before a UUID fix, rerun the local seeder to replace the
> affected rows.

## Rotate the platform super admin password

1. In Render, confirm the latest deploy contains the `admin:set-super-password` command.
2. In Render → Environment, set `SUPER_ADMIN_EMAIL` to the current platform super-admin email and
   `NEW_SUPER_ADMIN_PASSWORD` to a new password of at least 16 characters that is not the email.
3. In Render → Shell, run `npm run admin:set-super-password` once. A successful run prints only
   `updated`; if the matching platform account is not exactly one row, the command stops with an error.
4. In GitHub → repository → Settings → Secrets and variables → Actions, update
   `OSRM_PLATFORM_PASSWORD` to the same new password.
5. In Render → Environment, delete `NEW_SUPER_ADMIN_PASSWORD` after the rotation.

Never run seeders against production. The rotation command updates the existing `SUPER_ADMIN` row;
it does not create accounts or require a database migration.

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
| Retention worker               | Deletes GPS locations / notifications / refresh tokens / audit logs / resolved emergencies / expired idempotency keys past their policy age, and applies the marketing policies — anonymizing lead and recipient PII, never removing suppressions (`docs/data-retention.md`)                                               | `RETENTION_ENABLED`, `RETENTION_INTERVAL_MS` (default 6 h), `RETENTION_INITIAL_DELAY_MS` (default 30 s), `*_RETENTION_DAYS` |
| Marketing worker (composite)   | One tick drains both durable marketing queues: admin notification jobs first (`marketing_notification_jobs`), then campaign delivery (`email_campaign_recipients`). Separate tables, locks and caps; one timer                                                                                                        | `MARKETING_WORKER_ENABLED`, `MARKETING_WORKER_INTERVAL_MS`, `MARKETING_NOTIFY_*`, `MARKETING_*` delivery knobs            |
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
  successfully. Production databases are never seeded; demo and dummy seeders
  are restricted to opted-in development/test environments.
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
- [ ] SMTP configured and a test reset email received (otherwise school admins
      cannot recover their own accounts — check the boot log for
      `SmtpEmailProvider active`)
- [ ] `APP_URL` matches the public origin, so emailed reset links resolve
- [ ] Retention policies configured (including the `MARKETING_*_RETENTION_DAYS` windows)
- [ ] `MARKETING_ATTRIBUTION_SECRET` set (or accepted as disabled, knowingly)
- [ ] `MARKETING_PROVIDER_WEBHOOK_SECRET` left empty unless a real event
      source signs events — the endpoint must not be open without it
- [ ] Operators know that bounces/complaints are recorded by hand at
      `/admin/marketing/suppressions` on this Gmail SMTP setup
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
