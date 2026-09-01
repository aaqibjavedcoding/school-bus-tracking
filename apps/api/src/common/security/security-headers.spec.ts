import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  SecurityHeadersOptions,
  buildApiCspDirectives,
  buildExtraSecurityHeaders,
  buildHstsValue,
  createSecurityHeadersMiddleware,
  isHttpsRequest,
} from './security-headers.middleware';

function options(overrides: Partial<SecurityHeadersOptions> = {}): SecurityHeadersOptions {
  return {
    enabled: true,
    isProduction: true,
    hstsMaxAge: 15552000,
    hstsIncludeSubDomains: true,
    hstsPreload: false,
    cspEnabled: true,
    frameAncestors: "'none'",
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: 'geolocation=(self), camera=()',
    ...overrides,
  };
}

interface FakeResponse {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  removeHeader(name: string): void;
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name) {
      delete headers[name.toLowerCase()];
    },
  };
}

function run(
  opts: SecurityHeadersOptions,
  request: Partial<Request>,
): Promise<Record<string, string>> {
  const middleware = createSecurityHeadersMiddleware(opts);
  const response = fakeResponse();
  return new Promise((resolve, reject) => {
    middleware(
      { headers: {}, ...request } as Request,
      response as unknown as Response,
      (error?: unknown) => (error ? reject(error) : resolve(response.headers)),
    );
  });
}

describe('buildHstsValue', () => {
  it('is emitted only in production', () => {
    assert.equal(buildHstsValue(options({ isProduction: false })), null);
    assert.equal(
      buildHstsValue(options()),
      'max-age=15552000; includeSubDomains',
    );
    assert.equal(
      buildHstsValue(options({ hstsPreload: true })),
      'max-age=15552000; includeSubDomains; preload',
    );
  });
});

describe('isHttpsRequest', () => {
  it('detects direct TLS and a trusted forwarded proto', () => {
    assert.equal(isHttpsRequest(true, undefined), true);
    assert.equal(isHttpsRequest(false, 'https'), true);
    assert.equal(isHttpsRequest(false, 'https, http'), true);
    assert.equal(isHttpsRequest(false, ['https']), true);
    assert.equal(isHttpsRequest(false, 'http'), false);
    assert.equal(isHttpsRequest(undefined, undefined), false);
  });
});

describe('buildApiCspDirectives', () => {
  it('denies everything and pins frame-ancestors', () => {
    const directives = buildApiCspDirectives("'none'");
    assert.deepEqual(directives['default-src'], ["'none'"]);
    assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
    assert.deepEqual(directives['object-src'], ["'none'"]);
  });
});

describe('security headers middleware', () => {
  it('applies content-type, referrer, frame and permissions headers', async () => {
    const headers = await run(options(), {});
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['permissions-policy'], 'geolocation=(self), camera=()');
    assert.match(headers['content-security-policy'], /default-src 'none'/);
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  });

  it('omits HSTS on a plain-HTTP request', async () => {
    const headers = await run(options(), { secure: false });
    assert.equal(headers['strict-transport-security'], undefined);
  });

  it('sets HSTS for an HTTPS production request (direct or proxied)', async () => {
    const direct = await run(options(), { secure: true });
    assert.equal(direct['strict-transport-security'], 'max-age=15552000; includeSubDomains');

    const proxied = await run(options(), { headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(proxied['strict-transport-security'], 'max-age=15552000; includeSubDomains');
  });

  it('never sets HSTS outside production', async () => {
    const headers = await run(options({ isProduction: false }), { secure: true });
    assert.equal(headers['strict-transport-security'], undefined);
  });

  it('can be turned off entirely', async () => {
    const headers = await run(options({ enabled: false }), { secure: true });
    assert.deepEqual(headers, {});
  });

  it('drops the CSP when disabled but keeps the other headers', async () => {
    const headers = await run(options({ cspEnabled: false }), {});
    assert.equal(headers['content-security-policy'], undefined);
    assert.equal(headers['x-content-type-options'], 'nosniff');
  });
});

describe('buildExtraSecurityHeaders', () => {
  it('switches X-Frame-Options with the frame-ancestors policy', () => {
    assert.equal(buildExtraSecurityHeaders(options())['X-Frame-Options'], 'DENY');
    assert.equal(
      buildExtraSecurityHeaders(options({ frameAncestors: "'self'" }))['X-Frame-Options'],
      'SAMEORIGIN',
    );
  });
});
