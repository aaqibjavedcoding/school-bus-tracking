# Security

## Overview

This document describes the security measures implemented in the School Bus Tracking platform.

**No paid service/provider is included in this phase.**

## Authentication

### JWT-Based Authentication

- Access tokens: Short-lived (configurable, default 15 minutes)
- Refresh tokens: Long-lived (configurable, default 7 days), stored in httpOnly cookies
- CSRF protection: Double-submit cookie pattern
- Token rotation: Refresh tokens are rotated on each use — a stale token is
  rejected with `401 revoked` even when its session is still alive, so the
  replay defence is never bypassed
- Single-flight refresh: the client (`@school-bus-tracking/api-client`)
  allows at most one `POST /auth/refresh` in flight at a time. The
  AuthProvider boot (which React StrictMode runs twice on mount) and every
  401-retry path share one in-flight refresh promise, so a concurrent
  duplicate — the request that would always lose the rotation race — is never
  sent
- Session-presence marker: the readable, secret-free `sb_session` cookie
  mirrors the httpOnly refresh cookie so a fresh tab knows a refresh attempt
  is worthwhile. It is cleared on logout and on refresh failure — **except**
  a rotation conflict, where the presented token was superseded by a
  concurrent refresh whose rotated session is still live. Clearing the marker
  there would log every tab out on its next reload even though a valid
  session exists; the 401 itself is unchanged

### CSRF: the exact contract clients must follow

| Concern                           | Value                                                            | Configurable with           |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| Bootstrap endpoint                | `GET /api/v1/auth/csrf` (unauthenticated, safe)                  | —                           |
| Cookie                            | `csrf_token` — readable by scripts (**not** httpOnly), `Path=/`  | `CSRF_COOKIE_NAME`          |
| Header                            | `X-CSRF-Token` (the endpoint also returns `header_name`)         | `CSRF_HEADER_NAME`          |
| Session cookie the rule looks for | `refresh_token` (httpOnly, `Path=/api/v1/auth`)                  | `REFRESH_TOKEN_COOKIE_NAME` |
| Enforcement                       | global `CsrfGuard` (`evaluateCsrf` in `common/security/csrf.ts`) | `CSRF_ENABLED`              |

The rule, in order (see `evaluateCsrf`):

1. safe method (`GET`/`HEAD`/`OPTIONS`/`TRACE`) → allow;
2. no `Origin` header (native mobile, curl, server-to-server) → allow — not a browser;
3. `Origin` present but not in `CORS_ORIGIN` → **403** `Request origin is not allowed`;
4. `Authorization: Bearer …` → allow (a bearer token is never attached ambiently);
5. ambient `refresh_token` cookie → require `X-CSRF-Token` to equal the `csrf_token`
   cookie, else **403** `Invalid or missing CSRF token`.

**Web client flow** (implemented in `@school-bus-tracking/api-client`):

1. before any unsafe cookie-authenticated request (`/auth/login`, `/auth/refresh`,
   `/auth/logout`), read the `csrf_token` cookie; if it is missing, call
   `GET /auth/csrf` with `credentials: 'include'` and use the returned token;
2. echo it in `X-CSRF-Token`;
3. on a 403 CSRF rejection, re-seed **once** and replay (covers the 12h cookie TTL
   and rotation from another tab).

Step 1 is what keeps a browser out of the deadlock where it still holds the
httpOnly `refresh_token` cookie but has no CSRF cookie: without a bootstrap,
`refresh` _and_ `login` are both refused and the session can never be repaired.

Requests are same-origin: the Next.js app proxies `/api/v1/*` to the API through
`rewrites()`, which forwards `Origin`, `Cookie` and `X-CSRF-Token` and returns
`Set-Cookie` unchanged.

**Mobile is deliberately exempt.** React Native sends no `Origin` and
authenticates with a bearer token, so rule 2/4 applies and the client adds no
CSRF header (it has no cookie jar to read one from). Adding one would be
security theatre — there is no cross-site context on a native client.

### Password Security

- Bcrypt hashing with configurable rounds
- Password complexity requirements enforced
- Account lockout after failed attempts (rate limiting)

## Authorization

### Role-Based Access Control

- **SUPER_ADMIN**: Platform-level operations (school management, plans, subscriptions)
- **SCHOOL_ADMIN**: School-level operations (students, staff, buses, routes, trips)
- **DRIVER**: Trip-specific operations (attendance, GPS tracking)
- **CONDUCTOR**: Trip-specific operations (attendance, GPS tracking)
- **PARENT**: Read-only access to own children's data

### Tenant Isolation

Every database query is pinned with `school_id` from the verified JWT:

- Cross-tenant data access is impossible
- Cross-tenant mutation is impossible
- All failures return generic 404 (no information leakage)

## Multi-School Security Tests

Comprehensive E2E tests verify:

- Students, guardians, staff, buses, routes, stops, assignments, trips, attendance, documents, notifications, emergencies
- Arbitrary `school_id` in request body is ignored
- Arbitrary `school_id` query parameter is ignored
- Arbitrary resource IDs from another school are rejected
- Parent cannot access another parent's child
- Driver cannot access another driver's trip
- Conductor cannot access another conductor's trip
- Inactive school JWT is rejected
- Deactivated user JWT is rejected

## CORS

- Explicit allowlist (no wildcards in production)
- Credentials support
- Origin validation at startup

## Security Headers

- Helmet (X-Content-Type-Options, X-Frame-Options, etc.)
- HSTS (configurable, production only)
- CSP (configurable)
- Permissions-Policy
- Referrer-Policy
- The web CSP allows exactly one external image origin by default:
  `https://tile.openstreetmap.org` — the OpenStreetMap tile host the live
  tracking map is pinned to. Extra origins can be added per deployment via
  `CSP_EXTRA_IMG_SRC` / `CSP_EXTRA_CONNECT_SRC` (comma-separated, no wildcards).

## Dependency Security (Phase 2)

Status of `npm audit --omit=dev` after the Phase 2 hardening:

- **`postcss` (HIGH — fixed).** Next.js 14.2.35 pins `postcss@8.4.31` exactly,
  which is affected by source-map disclosure / XSS advisories
  (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp,
  GHSA-r28c-9q8g-f849). The root `overrides.postcss: 8.5.28` forces the
  vendor-patched 8.x release everywhere, including Next's nested copy.
- **`firebase-admin` (moderate chain — fixed).** Updated in-range
  ^14.3.0 → ^14.4.0, which dropped the vulnerable `@google-cloud/storage` /
  `teeny-request` / `retry-request` / `uuid` chain from the dependency tree.
  The app only uses `firebase-admin/app` and `firebase-admin/messaging`.
- **`next` 14.2.35 (CRITICAL — accepted mitigation, upgrade scheduled).**
  14.2.35 is the **final** release of the Next.js 14.x line; Vercel has stated
  no further 14.x patches will be published. The advisories aggregated by
  `npm audit` (RCE/SSRF/DoS classes) are fixed only in **15.5.21+ / 16.2.6+**,
  which require React 19 and an App Router migration — a dedicated later phase,
  deliberately out of scope here. Mitigations in place for this deployment:
  - `images.unoptimized: true` (`web/next.config.js`) removes the entire
    `/_next/image` optimizer attack surface (image SSRF/DoS, AVIF RCE, disk
    cache growth). The app renders no `next/image` at all.
  - The app uses **no** `middleware.ts`, **no** rewrites and **no** Server
    Actions, so the middleware-bypass, rewrite-smuggling/SSRF and Server-Action
    advisories have no applicable code path.
  - Self-host on Linux (the Windows-only RCE advisory does not apply) behind a
    reverse proxy with rate limiting for the DoS-class advisories.
  - **Follow-up (required):** migrate to Next.js 15.5.21+ / 16.x + React 19 in
    a dedicated phase.
- **Remaining moderates (accepted, no safe in-range fix).** The Expo SDK
  build-tooling chain (`expo`, `@expo/*`, `expo-router`, `decode-uri-component`,
  `query-string`, `xcode`) — fixes require an Expo SDK major upgrade, which
  would change mobile behaviour; and `uuid` (< 11.1.1, buffer bounds check) as
  a transitive dependency of `exceljs`/`sequelize` — the vendor fix is a
  downgrade of `exceljs` to 3.4.0 or an unsupported `uuid` override across
  packages that use its API. None of these are reachable from the web/API
  production runtime with attacker-controlled input.

## Production Database Configuration (Phase 2)

- With `NODE_ENV=production`, the API server **and** the migration/seed CLI
  refuse to start unless `DB_HOST`, `DB_NAME`, `DB_USERNAME` and `DB_PASSWORD`
  are set explicitly and `DB_SSL=true`. The development defaults
  (`postgres`/`postgres` on `localhost`, TLS off) are never silently applied in
  production; a single startup error lists every offending variable.
- Development and test environments keep their defaults; tests/smoke scripts
  (which run with `NODE_ENV=test` or unset) are unaffected.

## Document URL Hardening (Phase 2)

- `file_url` on every bus/driver document accepts only `http(s)` URLs (never
  `javascript:`/`data:`). In production only `https://` is accepted;
  development still allows `http://` for internal file stores.

## Seeding (Phase 2)

- Seeders never print passwords, emails' matching passwords, or any
  credential/secret. Success messages are generic; super admin credentials come
  from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` and production refuses to
  seed without them.

## Rate Limiting

- Per-endpoint rate limits (declared per route with a named policy)
- Per-identity login brute-force protection (school + email bucket, hashed)
- Per-user buckets for authenticated calls, per-IP for anonymous ones
- Every number configurable via environment variables, without a redeploy

### Deployment assumptions (single instance) — read before scaling

The limiter's counters live in a **process-local in-memory store**
(`MemoryRateLimitStore`, bounded at 50 000 keys with lazy eviction). This is a
deliberate, safe choice for the **single API instance** this project deploys
today (`server.js` hosting the web app, the API and Socket.IO together against
one PostgreSQL — see `docs/deployment.md`). Understand exactly what it means:

- **Horizontal scaling is not supported with this store.** With N instances
  behind a load balancer, each process counts its own buckets, so the
  effective limit becomes N × the configured limit and the login
  identity bucket no longer stops distributed credential stuffing.
- **Restarting the process wipes every bucket.** A brute-force window resets
  on deploy/crash; the protection is windowed (never a permanent lockout), so
  the exposure is bounded to the configured window size.
- `RATE_LIMIT_STORE=redis` **fails fast** at boot instead of silently
  degrading — pretending to be distributed would be worse than refusing to
  start. There is intentionally no Redis in this phase (no paid services, no
  extra infrastructure).

**Before horizontal scaling, all of the following must land together** (the
store boundary — `RateLimitStore` with `hit`/`reset` — already exists, so a
shared backend is a drop-in):

1. A shared `RateLimitStore` implementation (self-hosted Redis via the
   `RATE_LIMIT_STORE` seam, or a PostgreSQL-backed store) selected through
   configuration.
2. A Socket.IO adapter with a shared bus (e.g. `@socket.io/redis-adapter`) —
   realtime rooms/broadcasts are also process-local today.
3. A load balancer that terminates TLS and sets `X-Forwarded-For`, with
   `RATE_LIMIT_TRUST_PROXY=true` so the limiter keys on the real client IP.

Login/refresh rate limiting itself (limits, identity bucketing, windowing)
is unchanged by these decisions and must not be weakened.

## Audit Logging

All security-relevant operations are logged:

- Actor (user ID)
- Action
- Entity type and ID
- Timestamp
- Request ID
- IP address
- Safe metadata (no passwords, tokens, or medical data)

## Data Protection

### Sensitive Data

- Passwords: Never stored in plain text, never logged
- JWTs: Never stored in audit logs
- CSRF tokens: Never stored in audit logs
- Medical information: Not stored unnecessarily

### Data Retention

- GPS locations: Configurable (default 90 days)
- Notifications: Configurable (default 180 days)
- Refresh tokens: Configurable (default 30 days)
- Audit logs: Configurable (default 365 days)
- Emergency records: Configurable (default 730 days)

## WebSocket Security

- Handshake authentication (JWT verification)
- Clients never open a socket while signed out: `connectSocketWithToken`
  (web) / `connectAuthenticatedSocket` (mobile) skip the handshake when no
  access token is held, and every namespace socket is disconnected on
  sign-out or a failed refresh. The gateway check is unchanged — this only
  stops handshakes the server would refuse anyway (the
  `Rejected unauthenticated … socket` warnings)
- Room authorization (per-socket, per-trip)
- Session revalidation (periodic check for user/school deactivation)
- Payload validation (Zod schemas)

## Document Security

- File type allowlist (PDF, JPG, PNG, DOC, DOCX, XLS, XLSX)
- File size limits (10 MB)
- Filename sanitization
- Tenant authorization
- Secure access checks

## Emergency/SOS Security

- Immutable event history
- Actor tracking
- Server-side timestamps
- Location snapshots
- Status transition enforcement
- Audit log integration
