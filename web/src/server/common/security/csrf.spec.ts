import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { ConfigService } from '../../framework';
import {
  CSRF_INVALID_MESSAGE,
  CSRF_ORIGIN_REJECTED_MESSAGE,
  csrfTokensMatch,
  evaluateCsrf,
  generateCsrfToken,
} from './csrf';
import { CsrfGuard } from './csrf.guard';
import { buildCsrfClearCookieOptions, buildCsrfCookieOptions } from './csrf-cookie';

const WEB = 'https://app.school.example';
const EVIL = 'https://evil.example';
const TOKEN = 'a'.repeat(64);

describe('generateCsrfToken / csrfTokensMatch', () => {
  it('generates unique 64-character hex tokens', () => {
    const first = generateCsrfToken();
    const second = generateCsrfToken();
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.notEqual(first, second);
  });

  it('matches only identical tokens', () => {
    assert.equal(csrfTokensMatch(TOKEN, TOKEN), true);
    assert.equal(csrfTokensMatch(TOKEN, 'b'.repeat(64)), false);
    assert.equal(csrfTokensMatch(TOKEN, TOKEN.slice(0, 32)), false);
    assert.equal(csrfTokensMatch(undefined, TOKEN), false);
    assert.equal(csrfTokensMatch('', ''), false);
  });
});

describe('evaluateCsrf', () => {
  const base = {
    origin: WEB,
    originAllowed: true,
    hasBearerToken: false,
    hasSessionCookie: true,
    cookieToken: TOKEN,
    headerToken: TOKEN,
  };

  it('allows safe methods', () => {
    assert.deepEqual(evaluateCsrf({ ...base, method: 'GET', headerToken: null }), {
      allowed: true,
      reason: 'safe-method',
    });
  });

  it('allows native clients that send no Origin header', () => {
    assert.deepEqual(
      evaluateCsrf({ ...base, method: 'POST', origin: null, headerToken: null }),
      { allowed: true, reason: 'no-browser-origin' },
    );
  });

  it('rejects a browser request from an origin outside the allowlist', () => {
    assert.deepEqual(evaluateCsrf({ ...base, method: 'POST', origin: EVIL, originAllowed: false }), {
      allowed: false,
      reason: 'origin-rejected',
    });
  });

  it('allows a bearer-authenticated browser request without a CSRF token', () => {
    assert.deepEqual(
      evaluateCsrf({ ...base, method: 'POST', hasBearerToken: true, headerToken: null }),
      { allowed: true, reason: 'bearer-authenticated' },
    );
  });

  it('rejects a cookie-authenticated mutation with a missing or wrong token', () => {
    assert.deepEqual(evaluateCsrf({ ...base, method: 'POST', headerToken: null }), {
      allowed: false,
      reason: 'token-invalid',
    });
    assert.deepEqual(evaluateCsrf({ ...base, method: 'POST', headerToken: 'b'.repeat(64) }), {
      allowed: false,
      reason: 'token-invalid',
    });
  });

  it('accepts a cookie-authenticated mutation with a matching token', () => {
    assert.deepEqual(evaluateCsrf({ ...base, method: 'POST' }), {
      allowed: true,
      reason: 'token-valid',
    });
  });
});

describe('CSRF cookie options', () => {
  it('is readable by JavaScript and scoped to the whole site', () => {
    const options = buildCsrfCookieOptions({
      isProduction: false,
      isHttpsRequest: false,
      ttlMs: 1000,
    });
    assert.equal(options.httpOnly, false);
    assert.equal(options.path, '/');
    assert.equal(options.secure, false);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.maxAge, 1000);
  });

  it('becomes Secure + SameSite=None in production / over HTTPS', () => {
    const options = buildCsrfCookieOptions({
      isProduction: true,
      isHttpsRequest: false,
      ttlMs: 1000,
    });
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'none');
    assert.equal(buildCsrfClearCookieOptions({
      isProduction: true,
      isHttpsRequest: false,
      ttlMs: 1000,
    }).maxAge, undefined);
  });
});

function makeContext(request: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard(overrides: Record<string, unknown> = {}): CsrfGuard {
  const values: Record<string, unknown> = {
    'security.csrf.enabled': true,
    'security.csrf.cookieName': 'csrf_token',
    'security.csrf.headerName': 'x-csrf-token',
    'jwt.refreshCookieName': 'refresh_token',
    'security.isProduction': true,
    'security.corsOrigins': [WEB],
    'security.corsCredentials': true,
    ...overrides,
  };
  const configService = {
    get: <T>(key: string, fallback?: T) => (key in values ? (values[key] as T) : (fallback as T)),
  } as unknown as ConfigService;
  return new CsrfGuard(configService);
}

describe('CsrfGuard', () => {
  it('lets a same-site refresh through when the double-submit token matches', () => {
    const guard = makeGuard();
    const allowed = guard.canActivate(
      makeContext({
        method: 'POST',
        headers: { origin: WEB, 'x-csrf-token': TOKEN },
        cookies: { refresh_token: 'r', csrf_token: TOKEN },
      }),
    );
    assert.equal(allowed, true);
  });

  it('rejects the same request without the header (403)', () => {
    const guard = makeGuard();
    assert.throws(
      () =>
        guard.canActivate(
          makeContext({
            method: 'POST',
            headers: { origin: WEB },
            cookies: { refresh_token: 'r', csrf_token: TOKEN },
          }),
        ),
      (error: { getStatus?: () => number; message?: string }) => {
        assert.equal(error.getStatus?.(), 403);
        assert.equal(error.message, CSRF_INVALID_MESSAGE);
        return true;
      },
    );
  });

  it('rejects a cross-site origin outright', () => {
    const guard = makeGuard();
    assert.throws(
      () =>
        guard.canActivate(
          makeContext({
            method: 'POST',
            headers: { origin: EVIL, 'x-csrf-token': TOKEN },
            cookies: { refresh_token: 'r', csrf_token: TOKEN },
          }),
        ),
      (error: { message?: string }) => {
        assert.equal(error.message, CSRF_ORIGIN_REJECTED_MESSAGE);
        return true;
      },
    );
  });

  it('does not interfere with the mobile client (no Origin header)', () => {
    const guard = makeGuard();
    assert.equal(
      guard.canActivate(
        makeContext({
          method: 'POST',
          headers: { cookie: 'refresh_token=r' },
        }),
      ),
      true,
    );
  });

  it('reads cookies from the raw header when cookie-parser is bypassed', () => {
    const guard = makeGuard();
    assert.equal(
      guard.canActivate(
        makeContext({
          method: 'POST',
          headers: {
            origin: WEB,
            'x-csrf-token': TOKEN,
            cookie: `refresh_token=r; csrf_token=${TOKEN}`,
          },
        }),
      ),
      true,
    );
  });

  it('can be disabled by configuration', () => {
    const guard = makeGuard({ 'security.csrf.enabled': false });
    assert.equal(
      guard.canActivate(
        makeContext({ method: 'POST', headers: { origin: EVIL }, cookies: { refresh_token: 'r' } }),
      ),
      true,
    );
  });
});
