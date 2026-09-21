/**
 * HTTP security headers for the Next.js app.
 *
 * The API sets its own (much stricter, JSON-only) headers; this file covers
 * the *document* responses the browser renders. Kept as plain CommonJS so
 * `next.config.js` can require it without a build step, and unit-tested via
 * `src/lib/security-headers.spec.ts`.
 *
 * Content-Security-Policy notes — the policy is deliberately shaped around
 * what Next.js 14 actually needs, not around a checklist:
 *
 * - `'unsafe-inline'` for scripts is required in production because Next
 *   injects inline bootstrap/flight payload scripts (`__NEXT_DATA__`,
 *   streaming chunks). A nonce-based policy would need a custom server on
 *   every route; that is a larger change than this phase allows.
 * - `'unsafe-eval'` is added **only** in development, where React Refresh and
 *   the webpack dev runtime rely on it.
 * - `style-src` allows inline styles: React and MapLibre both set element
 *   styles directly.
 * - `connect-src` covers same-origin XHR/fetch, the Socket.IO websocket, and
 *   the vector-tile/style/glyph/sprite fetches performed by MapLibre GL JS
 *   against https://tiles.openfreemap.org (no key, no billing).
 * - `img-src` allows `data:`/`blob:` for map tiles and generated previews.
 * - `worker-src` includes `blob:` because MapLibre GL JS uses a Web Worker
 *   backed by a blob URL.
 */

const SELF = "'self'";

/**
 * The only external tile origin the app needs out of the box: OpenFreeMap's
 * public instance serving OpenStreetMap-derived vector tiles. The web console
 * uses MapLibre GL JS (`maplibre-gl`) with style
 * `https://tiles.openfreemap.org/styles/liberty` — no key, no account, no
 * billing. The engine fetches style JSON, vector tiles, glyphs and sprites via
 * `connect-src`, and may load raster fallbacks via `img-src`, so the host must
 * appear in both directives. Pinned to this exact host (no wildcard) so the
 * CSP stays narrow.
 */
const MAP_TILE_HOST = 'https://tiles.openfreemap.org';

/** Builds the CSP directive list for the web app. */
function buildContentSecurityPolicy(options = {}) {
  const isProduction = options.isProduction === true;
  const extraConnectSrc = (options.extraConnectSrc || []).filter(Boolean);
  const extraImgSrc = (options.extraImgSrc || []).filter(Boolean);
  const frameAncestors = options.frameAncestors || "'none'";

  const scriptSrc = [SELF, "'unsafe-inline'"];
  if (!isProduction) {
    scriptSrc.push("'unsafe-eval'");
  }

  const connectSrc = [SELF, 'ws:', 'wss:', MAP_TILE_HOST, ...extraConnectSrc];

  const directives = [
    `default-src ${SELF}`,
    `base-uri ${SELF}`,
    `form-action ${SELF}`,
    `frame-ancestors ${frameAncestors}`,
    `object-src 'none'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${SELF} 'unsafe-inline'`,
    `img-src ${SELF} data: blob: ${MAP_TILE_HOST} ${extraImgSrc.join(' ')}`.trim(),
    `font-src ${SELF} data:`,
    `connect-src ${connectSrc.join(' ')}`,
    `manifest-src ${SELF}`,
    `worker-src ${SELF} blob:`,
  ];

  if (isProduction) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Builds the header list consumed by `next.config.js`.
 *
 * HSTS is emitted only in production: sending it from a local `http://`
 * development server would pin the browser to HTTPS on `localhost`.
 */
function buildSecurityHeaders(options = {}) {
  const isProduction = options.isProduction === true;

  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      // Geolocation stays enabled for this origin: the live-tracking screens
      // use it. Everything else the app never needs is switched off.
      value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
    },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(options) },
  ];

  if (isProduction) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=15552000; includeSubDomains',
    });
  }

  return headers;
}

module.exports = { buildContentSecurityPolicy, buildSecurityHeaders };
