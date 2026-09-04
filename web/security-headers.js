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
 * - `style-src` allows inline styles: React and Leaflet both set element
 *   styles directly.
 * - `connect-src` covers same-origin XHR/fetch and the Socket.IO websocket,
 *   both of which are proxied through this origin by `rewrites()`.
 * - `img-src` allows `data:`/`blob:` for map tiles and generated previews.
 */

const SELF = "'self'";

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

  const connectSrc = [SELF, 'ws:', 'wss:', ...extraConnectSrc];

  const directives = [
    `default-src ${SELF}`,
    `base-uri ${SELF}`,
    `form-action ${SELF}`,
    `frame-ancestors ${frameAncestors}`,
    `object-src 'none'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src ${SELF} 'unsafe-inline'`,
    `img-src ${SELF} data: blob: ${extraImgSrc.join(' ')}`.trim(),
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
