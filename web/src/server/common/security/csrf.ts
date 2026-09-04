import { randomBytes, timingSafeEqual } from 'crypto';

/** Length in bytes of a generated CSRF token (64 hex characters). */
const CSRF_TOKEN_BYTES = 32;

/** Methods that never change state and therefore never need a CSRF token. */
export const CSRF_SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS', 'TRACE'];

export const CSRF_INVALID_MESSAGE = 'Invalid or missing CSRF token';
export const CSRF_ORIGIN_REJECTED_MESSAGE = 'Request origin is not allowed';

/** Cryptographically random double-submit token. */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('hex');
}

/** Constant-time token comparison that tolerates missing/odd-length input. */
export function csrfTokensMatch(cookieToken: unknown, headerToken: unknown): boolean {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
    return false;
  }
  if (cookieToken.length === 0 || cookieToken.length !== headerToken.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

export interface CsrfDecisionInput {
  method: string;
  /** `Origin` header, if any. Browsers always send it on state-changing requests. */
  origin?: string | null;
  /** True when the request carries an `Authorization: Bearer …` header. */
  hasBearerToken: boolean;
  /** True when the request carries the session (refresh) cookie. */
  hasSessionCookie: boolean;
  cookieToken?: string | null;
  headerToken?: string | null;
  /** True when `origin` is in the configured CORS allowlist. */
  originAllowed: boolean;
}

export type CsrfDecision =
  | { allowed: true; reason: 'safe-method' | 'no-browser-origin' | 'bearer-authenticated' | 'token-valid' }
  | { allowed: false; reason: 'origin-rejected' | 'token-invalid' };

/**
 * The single CSRF rule of the API.
 *
 * ```text
 * safe method .......................................... allow
 * no Origin header (native mobile / server client) ..... allow  (not a browser)
 * Origin present but not allowlisted ................... reject (403)
 * Origin allowlisted + Authorization: Bearer ........... allow  (token cannot be
 *                                                        replayed cross-site:
 *                                                        it is never ambiently
 *                                                        attached by the browser)
 * Origin allowlisted + cookie session .................. require a valid
 *                                                        double-submit token
 * ```
 *
 * Cross-site forgery is a *browser* problem: only a browser attaches cookies
 * ambiently, and only a browser is forced to send an `Origin` header it cannot
 * spoof from page JavaScript. Native clients (the Expo mobile app, curl,
 * server-to-server integrations) send no `Origin` and are therefore untouched —
 * which is what keeps the existing mobile refresh/logout flow working.
 */
export function evaluateCsrf(input: CsrfDecisionInput): CsrfDecision {
  if (CSRF_SAFE_METHODS.includes(input.method.toUpperCase())) {
    return { allowed: true, reason: 'safe-method' };
  }
  if (!input.origin) {
    return { allowed: true, reason: 'no-browser-origin' };
  }
  if (!input.originAllowed) {
    return { allowed: false, reason: 'origin-rejected' };
  }
  if (input.hasBearerToken) {
    return { allowed: true, reason: 'bearer-authenticated' };
  }
  if (!input.hasSessionCookie) {
    // A browser request with no ambient session cannot be a forgery of a
    // logged-in action; login itself is protected by the origin check above
    // and by the login rate limiter.
    return { allowed: true, reason: 'bearer-authenticated' };
  }
  if (csrfTokensMatch(input.cookieToken, input.headerToken)) {
    return { allowed: true, reason: 'token-valid' };
  }
  return { allowed: false, reason: 'token-invalid' };
}
