# Security

## Overview

This document describes the security measures implemented in the School Bus Tracking platform.

**No paid service/provider is included in this phase.**

## Authentication

### JWT-Based Authentication

- Access tokens: Short-lived (configurable, default 15 minutes)
- Refresh tokens: Long-lived (configurable, default 7 days), stored in httpOnly cookies
- CSRF protection: Double-submit cookie pattern
- Token rotation: Refresh tokens are rotated on each use

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

## Rate Limiting

- Per-endpoint rate limits
- Per-user rate limits
- Configurable via environment variables
- PostgreSQL-backed (no Redis required)

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
