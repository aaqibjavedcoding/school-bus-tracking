import type { RequestHandler } from 'express';
import helmet from 'helmet';

export interface SecurityHeadersOptions {
  enabled: boolean;
  isProduction: boolean;
  hstsMaxAge: number;
  hstsIncludeSubDomains: boolean;
  hstsPreload: boolean;
  cspEnabled: boolean;
  frameAncestors: string;
  referrerPolicy: string;
  permissionsPolicy: string;
}

/**
 * Directive map for the **API** Content-Security-Policy.
 *
 * The API serves JSON only (no HTML, no scripts, no styles), so the policy can
 * be maximally restrictive without any risk of breaking a page: everything is
 * denied and only `frame-ancestors` is configurable. The Next.js web
 * application ships its own, page-appropriate CSP (see
 * `web/security-headers.js`).
 */
export function buildApiCspDirectives(frameAncestors: string): Record<string, string[]> {
  return {
    'default-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': frameAncestors.split(/\s+/).filter(Boolean),
    'img-src': ["'none'"],
    'script-src': ["'none'"],
    'style-src': ["'none'"],
    'object-src': ["'none'"],
    'connect-src': ["'none'"],
    'font-src': ["'none'"],
  };
}

/** Header values applied on top of Helmet's defaults. */
export function buildExtraSecurityHeaders(options: SecurityHeadersOptions): Record<string, string> {
  return {
    'Permissions-Policy': options.permissionsPolicy,
    // Belt and braces alongside CSP `frame-ancestors` for legacy browsers.
    'X-Frame-Options': options.frameAncestors === "'none'" ? 'DENY' : 'SAMEORIGIN',
  };
}

/**
 * Express middleware applying the API security headers.
 *
 * - **HSTS** is emitted only for requests that actually arrived over HTTPS
 *   (directly or through a `X-Forwarded-Proto: https` load balancer) and only
 *   in production, so a plain-HTTP local/dev bootstrap is never poisoned by a
 *   `Strict-Transport-Security` entry in the browser cache.
 * - **X-Content-Type-Options**, **Referrer-Policy**, **X-Frame-Options**,
 *   **Cross-Origin-*** come from Helmet's defaults (adjusted below).
 * - **CSP** for JSON responses is `default-src 'none'`.
 * - **Permissions-Policy** is configurable and denies powerful features.
 */
export function createSecurityHeadersMiddleware(options: SecurityHeadersOptions): RequestHandler {
  if (!options.enabled) {
    return (_req, _res, next) => next();
  }

  const helmetHandler = helmet({
    contentSecurityPolicy: options.cspEnabled
      ? { useDefaults: false, directives: buildApiCspDirectives(options.frameAncestors) }
      : false,
    // Applied conditionally below (HTTPS requests only).
    strictTransportSecurity: false,
    referrerPolicy: { policy: options.referrerPolicy as never },
    // The API is consumed cross-origin by the mobile app; COEP would add no
    // value for a JSON API and can break legitimate clients.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const extraHeaders = buildExtraSecurityHeaders(options);
  const hstsValue = buildHstsValue(options);

  return (req, res, next) => {
    // Helmet runs first; the project-specific headers are applied afterwards
    // so they win over Helmet's defaults (for example `X-Frame-Options`,
    // which must follow the configured `frame-ancestors` policy).
    helmetHandler(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      for (const [name, value] of Object.entries(extraHeaders)) {
        res.setHeader(name, value);
      }
      if (hstsValue && isHttpsRequest(req.secure, req.headers['x-forwarded-proto'])) {
        res.setHeader('Strict-Transport-Security', hstsValue);
      }
      next();
    });
  };
}

/** `Strict-Transport-Security` value, or null when HSTS is disabled. */
export function buildHstsValue(options: SecurityHeadersOptions): string | null {
  if (!options.isProduction || options.hstsMaxAge <= 0) {
    return null;
  }
  const parts = [`max-age=${options.hstsMaxAge}`];
  if (options.hstsIncludeSubDomains) {
    parts.push('includeSubDomains');
  }
  if (options.hstsPreload) {
    parts.push('preload');
  }
  return parts.join('; ');
}

/** True when the original client connection used HTTPS. */
export function isHttpsRequest(secure: boolean | undefined, forwardedProto: unknown): boolean {
  if (secure) {
    return true;
  }
  const raw = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (typeof raw !== 'string') {
    return false;
  }
  return raw.split(',')[0]?.trim().toLowerCase() === 'https';
}
