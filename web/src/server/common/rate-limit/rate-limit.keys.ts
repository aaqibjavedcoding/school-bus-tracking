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
 * Identity-bucket settings of the `password_reset_public` policy.
 *
 * Structurally the same as {@link LoginBruteForceSettings} and keyed on the
 * same `school_id + email` identity, but configured separately
 * (`rateLimit.passwordResetPublic.*`) because the thing being bounded is
 * different: a login attempt costs the attacker a guess, while a
 * forgot-password request costs the *victim* an email. The allowance is
 * therefore much tighter than the login one — see the comment on
 * `passwordResetPublic` in `config/rate-limit.config.ts`.
 */
export interface PasswordResetPublicSettings {
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
 * **identity** bucket keyed by `school + email`, `auth_crew_login` one keyed
 * by the crew identity (see {@link extractCrewLoginIdentity}), and
 * `password_reset_public` one keyed by `school + email` again — which is what
 * actually stops credential stuffing (or reset-email flooding) distributed over
 * many IPs. All buckets are plain
 * fixed windows: a throttled caller always recovers automatically once the
 * window rolls over, so no legitimate user can be locked out permanently.
 */
export function buildRateLimitBuckets(
  context: RateLimitRequestContext,
  policy: RateLimitPolicySettings,
  login: LoginBruteForceSettings,
  crew: CrewLoginBruteForceSettings = login,
  passwordResetPublic: PasswordResetPublicSettings = login,
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

  if (context.policy === 'password_reset_public') {
    // Reuses the login identity extractor because it is literally the same
    // two fields — a forgot-password body is `{ school_id, email }`. The
    // bucket namespace is the policy name, so a reset request never consumes
    // (or is blocked by) that identity's login allowance.
    //
    // `POST /auth/reset-password` carries `{ token, password }` and yields no
    // identity, so it falls through with only the IP bucket. That is correct:
    // redeeming a link already requires holding 256 bits of secret.
    const identity = extractLoginIdentity(context.body);
    if (identity) {
      buckets.push({
        key: `${context.policy}|identity:${hashIdentity(identity)}`,
        limit: passwordResetPublic.identityLimit,
        windowMs: passwordResetPublic.identityWindowMs,
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
 * - **PIN branch** — the **submitted school**. The body is `{ school_id, pin }`
 *   and names no user, so the school is the only identity there is: this bucket
 *   is what stops one host from sweeping PINs across a list of school codes,
 *   and it survives an attacker rotating source addresses. It is deliberately
 *   the *raw submitted* string (trimmed, lower-cased), not a resolved tenant
 *   id: the guard runs before any database work, so an unresolvable code still
 *   gets its own bucket rather than sharing an `unknown-tenant` one with every
 *   other typo an attacker sends.
 * - **QR branch** — the presented pairing code. A code is single-use and
 *   expires in minutes, so the realistic abuse is replaying one captured code;
 *   keying on the code throttles exactly that, per code.
 *
 * The returned string is always passed through {@link hashIdentity} before it
 * becomes a bucket key, so neither a school code nor a live pairing token is
 * ever held in the limiter's memory in the clear.
 */
export function extractCrewLoginIdentity(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const candidate = body as {
    method?: unknown;
    school_id?: unknown;
    pairing_token?: unknown;
  };

  if (candidate.method === 'pin') {
    if (typeof candidate.school_id !== 'string' || candidate.school_id.trim() === '') {
      // No school means nothing to key on. The DTO rejects the body with a 400
      // anyway; the IP bucket above already counted the request.
      return null;
    }
    return `pin:${candidate.school_id.trim().toLowerCase()}`;
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
