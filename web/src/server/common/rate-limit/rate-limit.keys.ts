import { createHash } from 'crypto';

/** A single bucket the guard will increment for one request. */
export interface RateLimitBucket {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitRequestContext {
  policy: string;
  /** Resolved client IP (see {@link resolveClientIp}). */
  ip: string;
  /** Authenticated user id, when the route runs after `JwtAuthGuard`. */
  userId?: string | null;
  /** Parsed request body — only used for the login identity bucket. */
  body?: unknown;
}

export interface RateLimitPolicySettings {
  limit: number;
  windowMs: number;
}

export interface LoginBruteForceSettings {
  identityLimit: number;
  identityWindowMs: number;
}

/**
 * Identity-bucket settings of the `auth_crew_login` policy (Mobile-UX Phase 4).
 *
 * Structurally the same as {@link LoginBruteForceSettings} but configured
 * separately (`rateLimit.crewLogin.*`), because what counts as an "identity"
 * differs — see {@link extractCrewLoginIdentity}.
 */
export interface CrewLoginBruteForceSettings {
  identityLimit: number;
  identityWindowMs: number;
}

/**
 * Resolves the client IP.
 *
 * `X-Forwarded-For` is honoured **only** when the deployment declares it is
 * behind a trusted proxy (`RATE_LIMIT_TRUST_PROXY=true`); otherwise any client
 * could spoof the header and get a fresh bucket per request.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const first = raw?.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return remoteAddress?.trim() || 'unknown';
}

/** Short, non-reversible digest so bucket keys never contain raw PII. */
export function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/**
 * Buckets a request is counted against.
 *
 * Every policy gets an IP (or user) bucket. `auth_login` additionally gets an
 * **identity** bucket keyed by `school + email`, and `auth_crew_login` one keyed
 * by the crew identity (see {@link extractCrewLoginIdentity}) — which is what
 * actually stops credential stuffing distributed over many IPs. Both buckets are plain
 * fixed windows: a throttled caller always recovers automatically once the
 * window rolls over, so no legitimate user can be locked out permanently.
 */
export function buildRateLimitBuckets(
  context: RateLimitRequestContext,
  policy: RateLimitPolicySettings,
  login: LoginBruteForceSettings,
  crew: CrewLoginBruteForceSettings = login,
): RateLimitBucket[] {
  const principal = context.userId ? `user:${context.userId}` : `ip:${context.ip}`;
  const buckets: RateLimitBucket[] = [
    {
      key: `${context.policy}|${principal}`,
      limit: policy.limit,
      windowMs: policy.windowMs,
    },
  ];

  if (context.policy === 'auth_login') {
    const identity = extractLoginIdentity(context.body);
    if (identity) {
      buckets.push({
        key: `${context.policy}|identity:${hashIdentity(identity)}`,
        limit: login.identityLimit,
        windowMs: login.identityWindowMs,
      });
    }
  }

  if (context.policy === 'auth_crew_login') {
    const identity = extractCrewLoginIdentity(context.body);
    if (identity) {
      buckets.push({
        key: `${context.policy}|identity:${hashIdentity(identity)}`,
        limit: crew.identityLimit,
        windowMs: crew.identityWindowMs,
      });
    }
  }

  return buckets;
}

/**
 * Identity of a crew login attempt (Mobile-UX Phase 4), or null when the body
 * carries nothing usable.
 *
 * A crew login has no email to key on, so the identity is whatever the attempt
 * is actually *about*:
 *
 * - **PIN branch** — `(school_id, user_id)`: the account whose 4-digit PIN is
 *   being guessed. This bucket is what stops one host from walking a list of
 *   crew user ids, and it survives an attacker rotating source addresses.
 * - **QR branch** — the presented pairing code. A code is single-use and
 *   expires in minutes, so the realistic abuse is replaying one captured code;
 *   keying on the code throttles exactly that, per code.
 *
 * The returned string is always passed through {@link hashIdentity} before it
 * becomes a bucket key, so neither a user id nor a live pairing token is ever
 * held in the limiter's memory in the clear.
 */
export function extractCrewLoginIdentity(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const candidate = body as {
    method?: unknown;
    school_id?: unknown;
    user_id?: unknown;
    pairing_token?: unknown;
  };

  if (candidate.method === 'pin') {
    if (typeof candidate.user_id !== 'string' || candidate.user_id.trim() === '') {
      return null;
    }
    const school =
      typeof candidate.school_id === 'string' && candidate.school_id.trim() !== ''
        ? candidate.school_id.trim().toLowerCase()
        : 'unknown-tenant';
    return `pin:${school}:${candidate.user_id.trim().toLowerCase()}`;
  }

  if (candidate.method === 'qr') {
    if (typeof candidate.pairing_token !== 'string' || candidate.pairing_token.trim() === '') {
      return null;
    }
    return `qr:${candidate.pairing_token.trim()}`;
  }

  return null;
}

/** `school_id + email` of a login attempt, normalized; null when unusable. */
export function extractLoginIdentity(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const candidate = body as { email?: unknown; school_id?: unknown };
  if (typeof candidate.email !== 'string' || candidate.email.trim() === '') {
    return null;
  }
  const school =
    typeof candidate.school_id === 'string' && candidate.school_id.trim() !== ''
      ? candidate.school_id.trim().toLowerCase()
      : 'platform';
  return `${school}:${candidate.email.trim().toLowerCase()}`;
}

/** Seconds until the window resets, floored at 1 so `Retry-After` is useful. */
export function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
