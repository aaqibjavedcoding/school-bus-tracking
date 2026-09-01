# Security posture

Scope: the browser/API boundary — CORS, CSRF, security headers, rate limiting
and the session/lifecycle checks around JWTs. Everything here is
environment-configurable and covered by tests (`apps/api/src/common/security`,
`apps/api/src/common/rate-limit`, `apps/api/test/e2e`).

## Threat model in one paragraph

The API is multi-tenant and serves two very different clients: a first-party
web app (same origin as the API through the Next.js proxy, cookie-based refresh
session) and the mobile app (bearer tokens, no cookies). The rules below aim at
cross-site request forgery, cross-origin data theft, credential stuffing and
scripted abuse — **without** changing how the mobile app authenticates.

## CORS

`CORS_ORIGIN` is a comma-separated allowlist of browser origins:

```bash
CORS_ORIGIN=https://app.example.com,https://admin.example.com
CORS_CREDENTIALS=true      # default
```

* Requests with **no** `Origin` header (mobile, server-to-server, curl) are
  never blocked — CORS is a browser mechanism.
* An origin outside the allowlist is never echoed back; the browser then blocks
  the response.
* `CORS_ORIGIN=*` is accepted **outside production only**. In production it is
  rejected at boot (`CORS_WILDCARD_REJECTED_MESSAGE`), as is a missing/empty
  value (`CORS_NOT_CONFIGURED_MESSAGE`). The process fails fast rather than
  starting with a permissive policy.
* Outside production, an unset value falls back to `http://localhost:3000`.
* The same policy is applied to the Socket.IO adapter, so websockets cannot be
  used to bypass it.

## CSRF (double submit)

The refresh session lives in an httpOnly cookie, so a cross-site page could
otherwise trigger `POST /auth/refresh` with the victim's cookie attached. The
API therefore issues a second, deliberately **readable** cookie:

```text
csrf_token=<random>   (not httpOnly, SameSite, Path=/)
X-CSRF-Token: <same value>   ← the browser must echo it
```

`evaluateCsrf()` decides in this order:

| Condition | Result |
| --- | --- |
| Safe method (`GET`/`HEAD`/`OPTIONS`/`TRACE`) | allow |
| No `Origin` header (non-browser client) | allow |
| `Origin` not in the CORS allowlist | **403** |
| `Authorization: Bearer …` present | allow (mobile/API clients) |
| No session cookie present | allow (nothing to forge) |
| Cookie token === header token (timing-safe compare) | allow |
| otherwise | **403** |

The token is issued on login and refresh, rotated with the session, cleared on
logout, and can be fetched on demand with `GET /api/v1/auth/csrf`.
`@school-bus-tracking/api-client` reads the cookie and sets the header
automatically for every unsafe request, so application code needs no changes.

Tunables: `CSRF_ENABLED`, `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME`,
`CSRF_COOKIE_TTL_MS`.

## Session cookies

* `refresh_token` — httpOnly, `Path=/api/v1/auth`, `SameSite=lax` (or `none`
  when the request is HTTPS, so a cross-site deployment still works),
  `Secure` when the request arrived over HTTPS.
* Refresh tokens rotate on every use; a replayed token is rejected with 401.
* Logout clears both the refresh and the CSRF cookie.
* The legacy "refresh token in the request body" path is disabled by default
  and only re-enabled with `AUTH_ALLOW_REFRESH_TOKEN_IN_BODY=true`.

## Security headers

Helmet runs first, then the project middleware overrides what Helmet's defaults
get wrong for a JSON API:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; …` — the API serves JSON only, so nothing may be loaded or framed |
| `Strict-Transport-Security` | **only** when `NODE_ENV=production` *and* the request is HTTPS |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | configurable, restrictive default |
| `X-Powered-By` | removed |

The web app has its own header set in `apps/web/security-headers.js`, wired
into `next.config.js`. Its CSP is shaped around what Next.js 14 actually needs
(inline bootstrap scripts, inline styles, `data:`/`blob:` images, proxied
websockets) and `'unsafe-eval'` is development-only. It is unit-tested in
`apps/web/src/lib/security-headers.spec.ts`.

Tunables: `SECURITY_HEADERS_ENABLED`, `SECURITY_HSTS_MAX_AGE`,
`SECURITY_HSTS_INCLUDE_SUBDOMAINS`, `SECURITY_HSTS_PRELOAD`,
`SECURITY_CSP_ENABLED`, `SECURITY_FRAME_ANCESTORS`, `SECURITY_REFERRER_POLICY`,
`SECURITY_PERMISSIONS_POLICY`; on the web side `CSP_EXTRA_CONNECT_SRC` and
`CSP_EXTRA_IMG_SRC`.

## Rate limiting

A route declares a policy with `@RateLimit('<policy>')`; a global guard applies
it. Responses carry `RateLimit-Limit`, `RateLimit-Remaining`,
`RateLimit-Reset`, and a rejection is a `429` with `Retry-After` and the
standard error envelope (`RATE_LIMIT_EXCEEDED`, plus the policy name and the
retry delay in `details`).

| Policy | Default | Applies to |
| --- | --- | --- |
| `auth_login` | 10 / min per IP | `POST /auth/login` |
| `auth_refresh` | 60 / min | `POST /auth/refresh` |
| `auth_logout` | 30 / min | `POST /auth/logout` |
| `password_reset` | 10 / 15 min | password reset + admin password reset |
| `sos_create` | 12 / min | `POST /emergencies/sos` |
| `attendance_write` | 240 / min | board/drop mutations |
| `location_read` | 240 / min | GPS/location HTTP endpoints |
| `read_heavy` | 300 / min | expensive list/search endpoints |

Every number is overridable: `RATE_LIMIT_<POLICY>_LIMIT` and
`RATE_LIMIT_<POLICY>_WINDOW_MS`. `RATE_LIMIT_ENABLED=false` turns the guard off.

**Brute force.** Login is additionally throttled per identity (school + email):
`RATE_LIMIT_LOGIN_IDENTITY_LIMIT` failures (default 8) within
`RATE_LIMIT_LOGIN_IDENTITY_WINDOW_MS` (default 15 min) start returning 429. The
window is rolling and expires by itself — there is **no permanent lockout**, so
an attacker cannot deny service to a real user by burning their attempts.

**Client IP.** `X-Forwarded-For` is honoured only when
`RATE_LIMIT_TRUST_PROXY=true`. Behind a load balancer, set it; otherwise a
client could spoof the header and dodge the limiter.

### Multi-instance caveat (important)

The default store (`RATE_LIMIT_STORE=memory`) keeps counters **in process**.
With *N* API instances behind a load balancer the effective limit is up to
*N × limit*. This is correct for a single instance and acceptable as
defence-in-depth for several, but it is not a hard global cap.

A shared store is a small step: `RateLimitStore` is a three-method interface
(`consume`, `reset`, `clear`). Implementing it on Redis and selecting
`RATE_LIMIT_STORE=redis` is all that is needed. That implementation is
deliberately **out of scope** for this phase — selecting `redis` today makes the
application fail fast at boot instead of silently degrading to process-local
counters.

## Identity and lifecycle checks

Every authenticated request re-validates more than the signature:

* the JWT payload shape (`sub`, `school_id`, `role`; a `SUPER_ADMIN` must have
  no tenant),
* the school is still accessible — a token issued before the school was
  deactivated stops working immediately (403, `School is inactive`),
* the user is still active — a deactivated user's outstanding token stops
  working immediately (403, `User account is inactive`).

## Tenant isolation

Every tenant-scoped query is filtered by `school_id`, and a resource belonging
to another tenant produces the **same generic 404** as an id that does not
exist. Nothing in the status code, message or timing distinguishes "not yours"
from "not there". The rule is verified end to end in
`apps/api/test/e2e/cross-tenant.e2e.spec.ts`.

## Not covered by this phase

MFA, push/SMS/email delivery, payment providers, a Redis-backed limiter or
Socket.IO adapter, document object storage, and offline attendance. See the
phase notes in the pull request.
