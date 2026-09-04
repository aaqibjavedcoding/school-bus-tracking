import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildContentSecurityPolicy, buildSecurityHeaders } = require('../../security-headers.js');

function headerValue(headers: { key: string; value: string }[], key: string): string | undefined {
  return headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value;
}

describe('web security headers', () => {
  it('sets the baseline hardening headers', () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    assert.equal(headerValue(headers, 'X-Content-Type-Options'), 'nosniff');
    assert.equal(headerValue(headers, 'X-Frame-Options'), 'DENY');
    assert.equal(headerValue(headers, 'Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.match(String(headerValue(headers, 'Permissions-Policy')), /camera=\(\)/);
  });

  it('sends HSTS in production only', () => {
    const production = buildSecurityHeaders({ isProduction: true });
    assert.match(String(headerValue(production, 'Strict-Transport-Security')), /max-age=\d+/);

    const development = buildSecurityHeaders({ isProduction: false });
    assert.equal(headerValue(development, 'Strict-Transport-Security'), undefined);
  });

  it('blocks clickjacking through CSP as well as the legacy header', () => {
    const csp = buildContentSecurityPolicy({ isProduction: true });
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /form-action 'self'/);
  });

  it('keeps a policy Next.js can actually run', () => {
    const production = buildContentSecurityPolicy({ isProduction: true });
    // Next.js inlines its bootstrap and flight payload scripts.
    assert.match(production, /script-src [^;]*'unsafe-inline'/);
    // React and Leaflet set inline styles.
    assert.match(production, /style-src [^;]*'unsafe-inline'/);
    // Map tiles, blob previews and the proxied Socket.IO connection.
    assert.match(production, /img-src [^;]*data:/);
    assert.match(production, /connect-src [^;]*wss:/);
    // eval is a development-only concession for React Refresh.
    assert.doesNotMatch(production, /'unsafe-eval'/);
    assert.match(buildContentSecurityPolicy({ isProduction: false }), /'unsafe-eval'/);
  });

  it('upgrades insecure requests in production only', () => {
    assert.match(buildContentSecurityPolicy({ isProduction: true }), /upgrade-insecure-requests/);
    assert.doesNotMatch(
      buildContentSecurityPolicy({ isProduction: false }),
      /upgrade-insecure-requests/,
    );
  });

  it('accepts extra origins for deployments that need them', () => {
    const csp = buildContentSecurityPolicy({
      isProduction: true,
      extraConnectSrc: ['https://api.example.com'],
      extraImgSrc: ['https://tiles.example.com'],
    });
    assert.match(csp, /connect-src [^;]*https:\/\/api\.example\.com/);
    assert.match(csp, /img-src [^;]*https:\/\/tiles\.example\.com/);
  });
});
