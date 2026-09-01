import type { CookieOptions } from 'express';

export interface CsrfCookieInput {
  isProduction: boolean;
  isHttpsRequest: boolean;
  ttlMs: number;
}

/**
 * Cookie options for the double-submit CSRF token.
 *
 * Deliberately **not** `httpOnly`: the browser client must be able to read the
 * value and echo it back in the `X-CSRF-Token` header. That is safe — the
 * token is not a credential on its own; it only proves the request was issued
 * by same-site JavaScript rather than by an attacker's page.
 *
 * `sameSite`/`secure` mirror the refresh cookie so both survive the same
 * deployment topologies (including embedded HTTPS previews).
 */
export function buildCsrfCookieOptions(input: CsrfCookieInput): CookieOptions {
  const secure = input.isProduction || input.isHttpsRequest;
  return {
    httpOnly: false,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    maxAge: input.ttlMs,
  };
}

/** Matching options for `res.clearCookie` (no `maxAge`). */
export function buildCsrfClearCookieOptions(input: CsrfCookieInput): CookieOptions {
  const options = buildCsrfCookieOptions(input);
  return {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  };
}
