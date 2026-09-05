import { parseOriginList } from '../../config/security.config';

/** Message used when production boots without a usable CORS allowlist. */
export const CORS_NOT_CONFIGURED_MESSAGE =
  'CORS_ORIGIN must list at least one explicit browser origin in production (wildcard "*" is rejected).';

/** Message used when production is configured with a wildcard origin. */
export const CORS_WILDCARD_REJECTED_MESSAGE =
  'CORS_ORIGIN="*" is not allowed in production. List the exact web origins instead.';

export interface CorsPolicyInput {
  isProduction: boolean;
  /** Parsed allowlist (see `security.config.ts`). */
  corsOrigins: string[];
  credentials: boolean;
}

export interface CorsPolicy {
  /** Explicit allowlist; empty when `allowAll` is true. */
  origins: string[];
  /** True only outside production, when `*` was configured. */
  allowAll: boolean;
  credentials: boolean;
}

/**
 * Resolves and validates the CORS policy.
 *
 * Production rules (fail fast — a broken deployment beats a wide-open one):
 *
 * 1. `CORS_ORIGIN` must be set to at least one explicit origin.
 * 2. `*` is rejected outright, and is also rejected when mixed into a list.
 *
 * Outside production a missing value falls back to `http://localhost:3001` so
 * local development keeps working, and an explicit `*` is honoured for
 * throwaway environments. That is the origin the unified Next.js server serves
 * BOTH the web UI and the API from (`PORT`, default 3001) — before the NestJS
 * migration the UI ran on its own :3000 dev server, so the fallback pointed
 * there. A stale fallback is not cosmetic: `CsrfGuard` rejects every
 * state-changing browser request whose `Origin` is not in this list with
 * `403 Request origin is not allowed`, which would break login itself.
 */
export function resolveCorsPolicy(input: CorsPolicyInput): CorsPolicy {
  const origins = input.corsOrigins;
  const hasWildcard = origins.includes('*');

  if (input.isProduction) {
    if (hasWildcard) {
      throw new Error(CORS_WILDCARD_REJECTED_MESSAGE);
    }
    const explicit = origins.filter((origin) => origin !== '*');
    if (explicit.length === 0) {
      throw new Error(CORS_NOT_CONFIGURED_MESSAGE);
    }
    return { origins: explicit, allowAll: false, credentials: input.credentials };
  }

  if (hasWildcard) {
    // Credentialed wildcard CORS is not valid per the Fetch spec; browsers
    // reject `Access-Control-Allow-Origin: *` together with credentials.
    return { origins: [], allowAll: true, credentials: false };
  }

  const fallback = origins.length > 0 ? origins : parseOriginList('http://localhost:3001');
  return { origins: fallback, allowAll: false, credentials: input.credentials };
}

/** True when `origin` is permitted by `policy`. */
export function isOriginAllowed(policy: CorsPolicy, origin: string | undefined | null): boolean {
  if (policy.allowAll) {
    return true;
  }
  if (!origin) {
    // Non-browser clients (mobile app, server-to-server, curl) send no Origin.
    return true;
  }
  return policy.origins.includes(origin);
}

/**
 * Builds the option object consumed by `app.enableCors(...)`.
 *
 * The origin callback never throws: an unknown origin simply gets no
 * `Access-Control-Allow-Origin` header, which is what makes the browser block
 * the response (a thrown error would turn into a noisy 500).
 */
export function buildCorsOptions(policy: CorsPolicy): {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;
  methods: string;
  credentials: boolean;
  allowedHeaders: string[];
  exposedHeaders: string[];
  maxAge: number;
} {
  return {
    origin: (origin, callback) => callback(null, isOriginAllowed(policy, origin)),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: policy.credentials,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    exposedHeaders: ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600,
  };
}
