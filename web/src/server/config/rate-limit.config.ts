import { registerAs } from '../framework';

/**
 * Application-level rate limiting / abuse protection.
 *
 * Limits are expressed as "at most `limit` requests per `windowMs` per
 * bucket key". Each protected route declares a *policy name* with the
 * `@RateLimit()` decorator; the numbers below are the tunables for those
 * policies and every one of them can be overridden from the environment:
 *
 * ```text
 * RATE_LIMIT_<POLICY>_LIMIT       e.g. RATE_LIMIT_AUTH_LOGIN_LIMIT=10
 * RATE_LIMIT_<POLICY>_WINDOW_MS   e.g. RATE_LIMIT_AUTH_LOGIN_WINDOW_MS=60000
 * ```
 *
 * The two brute-force identity buckets have their own overrides:
 * `RATE_LIMIT_LOGIN_IDENTITY_*` (email login) and
 * `RATE_LIMIT_CREW_LOGIN_IDENTITY_*` (crew PIN/QR login). The crew PIN
 * **lockout** is configured separately, in `crew-auth.config.ts`.
 *
 * Defaults are chosen so that a normal school day is never impacted: a bus
 * crew marking 60 students in a minute, a dispatcher refreshing lists, or a
 * parent app polling are all comfortably inside the caps, while credential
 * stuffing and scripted abuse are not.
 *
 * `RATE_LIMIT_ENABLED=false` turns the guard off entirely (useful for load
 * testing and for unit-test bootstraps).
 *
 * `RATE_LIMIT_STORE` selects the backing store:
 *   `memory` (default) — process-local counters. Correct for a single API
 *                        instance; see `docs/security.md` for the multi-instance
 *                        caveat.
 *   `redis`            — reserved. A Redis-backed store is intentionally out of
 *                        scope for this phase; selecting it fails fast instead
 *                        of silently degrading to process-local counters.
 */
export default registerAs('rateLimit', () => ({
  enabled: process.env.RATE_LIMIT_ENABLED?.trim().toLowerCase() !== 'false',
  store: (process.env.RATE_LIMIT_STORE || 'memory').trim().toLowerCase(),
  /**
   * Trust `X-Forwarded-For` when deriving the client IP. Enable only behind a
   * trusted reverse proxy / load balancer, otherwise a client can spoof the
   * header and dodge the limiter.
   */
  trustProxy: process.env.RATE_LIMIT_TRUST_PROXY?.trim().toLowerCase() === 'true',
  policies: {
    /** Credential submission — per IP *and* per submitted identity. */
    auth_login: policy('AUTH_LOGIN', 10, 60_000),
    /**
     * Crew PIN / QR login (Mobile-UX Phase 4) — per IP *and* per submitted
     * identity, exactly like `auth_login`.
     *
     * This is the **outer** of the two brute-force layers on the PIN path; the
     * inner one is the per-user attempt lockout in `crew-auth.config.ts`
     * (5 failures → 15 min lockout), which is tighter and therefore normally
     * fires first. Both exist on purpose: the lockout is keyed on the crew
     * account and is what bounds guessing against one driver, while this bucket
     * is keyed on the identity *as submitted* and also covers the QR branch,
     * where a replayed or guessed pairing code has no PIN lockout at all.
     *
     * 10 per minute per IP is generous for a real depot — a whole bus crew
     * signing in behind one NAT address is a handful of requests — and far too
     * tight for a scripted spray.
     */
    auth_crew_login: policy('AUTH_CREW_LOGIN', 10, 60_000),
    /**
     * Minting a crew login QR (privileged, admin-only, low volume). Each call
     * writes a row and invalidates the crew member's outstanding code, so it is
     * capped like `password_reset` rather than like a read.
     */
    crew_pairing: policy('CREW_PAIRING', 10, 15 * 60_000),
    /** Session rotation. Generous: every tab refreshes on 401. */
    auth_refresh: policy('AUTH_REFRESH', 60, 60_000),
    auth_logout: policy('AUTH_LOGOUT', 30, 60_000),
    /** Admin-initiated password resets (privileged, low volume). */
    password_reset: policy('PASSWORD_RESET', 10, 15 * 60_000),
    /** Crew SOS creation — must stay usable in a real emergency. */
    sos_create: policy('SOS_CREATE', 12, 60_000),
    /** Attendance board/drop mutations (a full bus is ~60 scans/minute). */
    attendance_write: policy('ATTENDANCE_WRITE', 240, 60_000),
    /** HTTP location reads/writes (the GPS ingest path is the gateway). */
    location_read: policy('LOCATION_READ', 240, 60_000),
    /** Expensive list/search endpoints. */
    read_heavy: policy('READ_HEAVY', 300, 60_000),
    /**
     * Push device token register/unregister — one per login/app start/token
     * refresh. Tight enough to stop token spam, generous for a normal
     * device lifecycle.
     */
    device_register: policy('DEVICE_REGISTER', 30, 60_000),
    /**
     * Spreadsheet uploads (validate + commit). Deliberately tight: each request
     * parses a file, runs thousands of validations and can hash hundreds of
     * passwords, so it is by far the most expensive thing a tenant can ask for.
     * Twelve per minute still covers an admin iterating on a file they are
     * fixing row by row.
     */
    data_import: policy('DATA_IMPORT', 12, 60_000),
    /** Streaming exports — each one can walk a whole table. */
    data_export: policy('DATA_EXPORT', 30, 60_000),
    /** Report queries and report exports (heavy aggregation, read-only). */
    report_read: policy('REPORT_READ', 120, 60_000),
  },
  /**
   * Login brute-force protection is *windowed*, never a permanent lockout: a
   * blocked identity/IP recovers automatically after `windowMs`.
   */
  login: {
    /** Failed attempts per identity (school + email) before throttling. */
    identityLimit: positiveInt(process.env.RATE_LIMIT_LOGIN_IDENTITY_LIMIT, 8),
    identityWindowMs: positiveInt(process.env.RATE_LIMIT_LOGIN_IDENTITY_WINDOW_MS, 15 * 60_000),
  },
  /**
   * Identity bucket of the `auth_crew_login` policy.
   *
   * The "identity" of a crew login is not an email: on the PIN branch it is
   * `(school_id, user_id)` — the account whose PIN is being guessed — and on the
   * QR branch it is the presented pairing code itself, so replaying one
   * consumed or stolen code is throttled per code. Both are hashed before they
   * become a bucket key, so no raw identifier or token is held in memory.
   */
  crewLogin: {
    identityLimit: positiveInt(process.env.RATE_LIMIT_CREW_LOGIN_IDENTITY_LIMIT, 8),
    identityWindowMs: positiveInt(
      process.env.RATE_LIMIT_CREW_LOGIN_IDENTITY_WINDOW_MS,
      15 * 60_000,
    ),
  },
}));

export interface RateLimitPolicyConfig {
  limit: number;
  windowMs: number;
}

function policy(envPrefix: string, limit: number, windowMs: number): RateLimitPolicyConfig {
  return {
    limit: positiveInt(process.env[`RATE_LIMIT_${envPrefix}_LIMIT`], limit),
    windowMs: positiveInt(process.env[`RATE_LIMIT_${envPrefix}_WINDOW_MS`], windowMs),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
