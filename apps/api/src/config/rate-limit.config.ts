import { registerAs } from '@nestjs/config';

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
