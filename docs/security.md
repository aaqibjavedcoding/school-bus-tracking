# Security

## Overview

This document describes the security measures implemented in the KidBus platform.

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
- The web CSP allows exactly one external map origin by default:
  `https://tiles.openfreemap.org` — OpenFreeMap's public instance (OpenStreetMap
  data, no key, no billing) that the live tracking map (`maplibre-gl` v5) is
  pinned to, in both `img-src` and `connect-src` plus `worker-src blob:` for the
  MapLibre worker. Extra origins can be added per deployment via
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

## Crew PIN Brute Force

Crew (DRIVER / CONDUCTOR) sign in to the phone app with a **school code
and a 4-digit PIN** (`CREW_PIN_LENGTH = 4`,
`CREW_PIN_COMBINATIONS = 10_000`) instead of an email + password,
because a driver standing in a depot at 6am cannot be asked for an
email address and an 8-character password.

The request body is `{ method: 'pin', school_id, pin }` — **there is no
user id**. A UUID copied off an admin screen was never a secret, so
asking for one bought nothing; the server resolves the account itself by
comparing the submitted PIN against every active DRIVER/CONDUCTOR of the
resolved tenant that has a PIN set. Two consequences follow, and both are
enforced in code rather than assumed:

- **A PIN is unique per school.** `CrewAuthService.setPin` refuses a PIN
  that another _active_ crew member of the same school already holds
  (`CREW_PIN_DUPLICATE`, HTTP 409) — otherwise "whose hash does this PIN
  verify against?" would have two answers. `loginWithPin` still refuses
  to resolve an ambiguous PIN (`CREW_PIN_AMBIGUOUS`, HTTP 401, no
  session) as defence in depth for a hand-edited or pre-uniqueness
  database. No unique index can back this: a bcrypt digest is salted per
  row, so the database cannot see that two hashes are the same PIN.
- **The brute-force budget is per school, not per driver.** See below.

A 4-digit PIN covers `10_000` values — survivable only because guessing
is _slow_, via three layered throttles:

1. **Per-school PIN lockout**
   (`web/src/server/modules/auth/crew-pin-attempts.ts`). Keyed by the
   **submitted school** (a code that resolves to nothing is keyed on the
   raw lower-cased code, so a bogus code cannot eat a real school's
   allowance), not by IP, so an attacker rotating source addresses still
   gets one bounded budget per tenant. Shipped defaults
   (`CREW_PIN_DEFAULT_POLICY`):
   - `maxAttempts: 5`
   - `windowMs: 15 * 60_000` (15 minutes)
   - `lockoutMs: 15 * 60_000` (15 minutes)

     On the fifth failure inside the window the lockout trips
     immediately — the Nth wrong PIN is refused-with-lock, not
     allowed-then-locked, so an attacker never gets a free extra guess by
     racing the boundary. **Every** failed attempt counts against the
     school: a wrong PIN, an ambiguous PIN, and an unknown school code
     alike, so the `remaining_attempts` countdown is identical for a real
     school and a random string.

     ### Why the key is the school and not something narrower
     - A per-`(school, user_id)` counter **no longer exists to key on** —
       nothing in the request names a user.
     - A per-`(school, PIN)` counter **would not bound anything**. The
       realistic attack is a sweep (`1234`, `1235`, `1236`, …): ten
       thousand distinct PINs would each get a fresh counter, so
       `maxAttempts` per counter hands the attacker the whole space.
     - A school-wide counter is the only key an attacker cannot rotate,
       and it bounds the sweep to **480 guesses/day/school**.

2. **Endpoint rate-limit policy** (`auth_crew_login`, in
   `web/src/server/config/rate-limit.config.ts`). 10 attempts per 60 s
   per IP _and_ per **submitted school** identity bucket — one host
   cannot walk a list of school codes. The bucket key is the raw
   submitted code, hashed, because the guard runs before any database
   work.
3. **Audit trail**. Every success and every failure is written to
   `audit_logs`. A failed attempt records the school it was aimed at and
   `entity_id: null` (a rejection is not an action _by_ anyone); a
   success records the **resolved** crew member in `entity_id`,
   `actor_user_id` and `metadata.user_id`. Neither the PIN nor a pairing
   token is ever written to the trail, a log line, or an error message.

With the shipped policy the sustainable guess rate against one school is
**5 attempts per 15-minute window, plus a 15-minute lockout**, so one
school yields **480 guesses per day** and walking the entire PIN space
takes **≈20.8 days of continuous, perfectly-timed guessing**
(`estimatePinExhaustionDays` in `crew-pin-attempts.ts` — pinned by
`crew-pin-attempts.spec.ts`; this figure is computed, not quoted). Every
one of those attempts is an audited failure.

Two properties make the PIN check itself leak nothing:

- **A fixed number of bcrypt comparisons always runs.**
  `resolveCrewPinMatch` (`crew-auth.service.ts`) compares the submitted
  PIN against **every** candidate — never short-circuiting on a match —
  and pads the shortfall with comparisons against
  `PIN_TIMING_EQUALIZATION_HASH` up to `CREW_PIN_COMPARISON_COUNT` (8).
  So a school with no crew PINs, a school with one driver, a wrong PIN
  and a correct PIN all cost exactly eight cost-12 comparisons, and
  response timing cannot reveal whether a match was found. A school with
  _more_ than eight candidates does more work — it must, or the ninth
  driver could not log in — so timing can reveal roughly how many crew a
  school has; it cannot reveal whether the PIN was right. The cost is
  ~2 s of bcrypt per PIN login, which is the deliberate price of the
  invariant; the comparisons run concurrently and `bcryptjs` yields
  between chunks, so the server keeps serving other requests.
- **The lockout counts unknown schools too.** A failure is registered
  against the submitted code whether or not it resolves, so the
  countdown is not an enumeration oracle for "which school codes are
  real".

Mobile crew login uses **school code + PIN only**. Drivers never scan or paste a
pairing code; they wait for lockout expiry or ask an administrator to reset their PIN.
The server retains these admin-authorized recovery mechanisms:

- **Successful QR pairing login (dormant, optional admin capability)** (`CrewAuthService.loginWithPairingCode`)
  calls `attempts.forget(...)` on the crew member's school — only an
  administrator can mint the code that gets a device here, which is
  exactly the authority that should be able to lift a lockout.
- **Administrator sets, resets or clears any PIN at that school**
  (`CrewAuthService.setPin`) also calls `attempts.forget(...)`. Since the
  lockout is school-wide, this is the active admin-assisted recovery path for mobile
  drivers, and it clears the counter for every driver at the school —
  an admin who has just been told "the depot is locked out" must not also
  wait a quarter of an hour.

### Known limitations (stated, not hidden)

- **The PIN attempt counters are process-local.** `CrewPinAttemptStore`
  is an in-memory map, exactly like `MemoryRateLimitStore`. README §18
  pins the supported topology at a single Node process; **behind N
  instances behind a load balancer an attacker's guesses are spread
  across processes and the effective allowance becomes `N × maxAttempts`
  per window**, and **a restart clears every counter mid-window**. Raising
  the configured numbers does **not** fix this — a distributed counter
  does, and it is the same deferred Redis work the rate limiter already
  names above (see "Before horizontal scaling"). Same precondition, same
  checklist item, same reason to ship it together with the rate limiter
  when the time comes.
- **A school-wide lockout is a tenant-wide denial of service.** Five
  wrong PINs from anyone lock the PIN path for **every** driver at that
  school for up to `lockoutMs`. This is inherent to the only key that
  bounds a PIN sweep and it is the deliberate trade: the alternative is
  an unbounded guess budget. It is also a larger blast radius than the
  per-user lockout this replaced — one driver's mistypes now affect their
  colleagues — which is exactly why both recovery routes above clear the
  whole school's counter rather than one account's.
- **PIN uniqueness is enforced at write time, not by the database.** A
  bulk import, a restore from an old dump, or a hand edit can still
  create a collision; `loginWithPin` then refuses the login with
  `CREW_PIN_AMBIGUOUS` rather than picking one of the two accounts. The
  fix is an administrator setting a different PIN, and the error message
  says so.
- **A stolen `pin_hash` column is crackable.** bcrypt at cost 12 slows an
  offline attack on a password to impracticality, but a 4-digit PIN has
  only 10 000 candidates, so an attacker who has already read the
  database can exhaust them in minutes regardless of the work factor.
  Mobile PIN login requires a school code and an administrator-set PIN,
  not prior QR device pairing. A database compromise exposes the PIN hashes
  and compromises those credentials. This is documented
  rather than papered over with a higher cost factor that would only
  make login slower.

### Pairing QR — dormant, optional admin capability

QR pairing is not a driver-facing mobile flow. The admin staff-page QR panel,
driver/conductor pairing-QR endpoints, `POST /auth/crew-login` QR branch, and
`crew_pairing_tokens` table remain available as a dormant, optional admin capability.
There is no mobile QR tab, scanner, or paste path.

The retained QR capability does **not** share the process-local counter limitation: pairing codes live in
PostgreSQL (`crew_pairing_tokens`, migration
`20260915120100-create-crew-pairing-tokens.ts`), so they survive a
restart and are correct under more than one instance. The plaintext
token is returned to the administrator **once** and only its SHA-256
digest is stored, so a later database read — or a leaked backup —
cannot resurrect a live code. Each pairing code is **single-use and
expires after 5 minutes** (`pairingTtlMs` in
`web/src/server/config/crew-auth.config.ts`); a redeemed or expired
code is rejected with `CREW_PAIRING_INVALID`.

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
