import { registerAs } from '@nestjs/config';

/**
 * Browser-security configuration (CORS, CSRF, security headers).
 *
 * Every value is environment-backed so an operator can adapt the policy per
 * environment without a code change. The production posture is deliberately
 * strict and *fails fast*: a misconfigured deployment must not silently fall
 * back to a permissive policy.
 *
 * Environment variables
 * ---------------------
 * `CORS_ORIGIN`                  comma-separated allowlist of browser origins
 *                                (e.g. `https://app.example.com,https://admin.example.com`).
 *                                `*` is accepted outside production only.
 * `CSRF_ENABLED`                 `false` disables the double-submit CSRF check
 *                                (default: enabled).
 * `CSRF_COOKIE_NAME`             name of the readable CSRF cookie
 *                                (default `csrf_token`).
 * `CSRF_HEADER_NAME`             name of the header the browser must echo
 *                                (default `x-csrf-token`).
 * `SECURITY_HEADERS_ENABLED`     `false` disables the Helmet middleware.
 * `SECURITY_HSTS_MAX_AGE`        HSTS max-age in seconds (default 15552000).
 * `SECURITY_CSP_ENABLED`         `false` disables the API Content-Security-Policy
 *                                (default enabled — the API only serves JSON).
 * `SECURITY_FRAME_ANCESTORS`     `frame-ancestors` directive (default `'none'`).
 * `SECURITY_PERMISSIONS_POLICY`  raw `Permissions-Policy` header value.
 */
export default registerAs('security', () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const rawCorsOrigin = process.env.CORS_ORIGIN;
  const corsOrigins = parseOriginList(rawCorsOrigin);

  return {
    nodeEnv,
    isProduction,
    /** Raw configured value, kept for diagnostics/tests. */
    rawCorsOrigin: rawCorsOrigin ?? null,
    /** Parsed allowlist. Empty when unset; `['*']` when explicitly wildcarded. */
    corsOrigins,
    corsCredentials: process.env.CORS_CREDENTIALS?.trim().toLowerCase() !== 'false',
    csrf: {
      enabled: process.env.CSRF_ENABLED?.trim().toLowerCase() !== 'false',
      cookieName: process.env.CSRF_COOKIE_NAME || 'csrf_token',
      headerName: (process.env.CSRF_HEADER_NAME || 'x-csrf-token').toLowerCase(),
      /** Lifetime of the CSRF cookie in ms (default 12h). */
      ttlMs: positiveInt(process.env.CSRF_COOKIE_TTL_MS, 12 * 60 * 60 * 1000),
    },
    headers: {
      enabled: process.env.SECURITY_HEADERS_ENABLED?.trim().toLowerCase() !== 'false',
      hstsMaxAge: positiveInt(process.env.SECURITY_HSTS_MAX_AGE, 15552000),
      hstsIncludeSubDomains:
        process.env.SECURITY_HSTS_INCLUDE_SUBDOMAINS?.trim().toLowerCase() !== 'false',
      hstsPreload: process.env.SECURITY_HSTS_PRELOAD?.trim().toLowerCase() === 'true',
      cspEnabled: process.env.SECURITY_CSP_ENABLED?.trim().toLowerCase() !== 'false',
      frameAncestors: process.env.SECURITY_FRAME_ANCESTORS || "'none'",
      referrerPolicy: process.env.SECURITY_REFERRER_POLICY || 'strict-origin-when-cross-origin',
      permissionsPolicy:
        process.env.SECURITY_PERMISSIONS_POLICY ||
        'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(self), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    },
    /**
     * Accept a refresh token supplied in the JSON body of `POST /auth/refresh`
     * / `POST /auth/logout`.
     *
     * Disabled by default: both first-party clients (Next.js web app and the
     * Expo mobile app) rely on the httpOnly refresh cookie, and accepting a
     * body token widens the attack surface for no benefit. Operators
     * integrating a non-browser client that genuinely cannot keep a cookie
     * jar can opt in explicitly with `AUTH_ALLOW_REFRESH_TOKEN_IN_BODY=true`.
     */
    allowRefreshTokenInBody:
      process.env.AUTH_ALLOW_REFRESH_TOKEN_IN_BODY?.trim().toLowerCase() === 'true',
  };
});

/** Splits a comma/whitespace separated origin list, dropping empty entries. */
export function parseOriginList(raw: string | undefined | null): string[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
