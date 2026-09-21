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
    // React and MapLibre set inline styles.
    assert.match(production, /style-src [^;]*'unsafe-inline'/);
    // Map tiles, blob previews and the proxied Socket.IO connection.
    assert.match(production, /img-src [^;]*data:/);
    assert.match(production, /connect-src [^;]*wss:/);
    // eval is a development-only concession for React Refresh.
    assert.doesNotMatch(production, /'unsafe-eval'/);
    assert.match(buildContentSecurityPolicy({ isProduction: false }), /'unsafe-eval'/);
  });

  it('allows exactly the OpenFreeMap tile origin the map fetches from (vector tiles need connect-src + img-src)', () => {
    for (const isProduction of [true, false]) {
      const csp = buildContentSecurityPolicy({ isProduction });
      const imgSrc = String(
        csp.split(';').find((directive) => directive.trim().startsWith('img-src')),
      );
      const connectSrc = String(
        csp.split(';').find((directive) => directive.trim().startsWith('connect-src')),
      );
      // The one trusted tile origin is present in both…
      assert.match(imgSrc, /https:\/\/tiles\.openfreemap\.org/);
      assert.match(connectSrc, /https:\/\/tiles\.openfreemap\.org/);
      // …and the policy never opens img-src to arbitrary hosts.
      assert.ok(!imgSrc.includes('*'), `img-src must not use a wildcard: ${imgSrc}`);
      assert.ok(!connectSrc.includes('*'), `connect-src must not use a wildcard: ${connectSrc}`);
      // Old OSM raster host must be gone
      assert.doesNotMatch(imgSrc, /tile\.openstreetmap\.org/);
      assert.doesNotMatch(connectSrc, /tile\.openstreetmap\.org/);
    }
  });

  it('keeps worker-src blob: for MapLibre GL JS workers', () => {
    const csp = buildContentSecurityPolicy({ isProduction: true });
    const workerSrc = String(
      csp.split(';').find((directive) => directive.trim().startsWith('worker-src')),
    );
    assert.match(workerSrc, /blob:/);
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
