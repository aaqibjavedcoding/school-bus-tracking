/**
 * Password-reset token policy — the pure half.
 *
 * Everything that decides whether a reset link may be redeemed lives here:
 * how long a link lives, when it is expired, when it is spent, and which of a
 * user's older links a new one kills. The database half (`PasswordResetToken`)
 * only stores the answers.
 *
 * The file is deliberately framework-free — no Sequelize, no HTTP, no clock of
 * its own. Every function takes `now` as an argument and returns a new value,
 * which is what makes the policy testable under `node --test` (the repo has no
 * Jest/Vitest) and lets `password-reset-tokens.spec.ts` walk a whole timeline
 * deterministically. It is the same shape as `crew-pin-attempts.ts`, for the
 * same reason.
 *
 * ### Why a reset link is a different animal from a crew PIN
 *
 * A 4-digit PIN is guessable, so `crew-pin-attempts.ts` is mostly a throttle.
 * A reset token is 256 bits of `crypto.randomBytes` rendered as 64 hex
 * characters (`generateRefreshToken()`) and stored only as its SHA-256 digest
 * — it is not guessable, and no lockout would make it more so. What can go
 * wrong with a *link* is different, and this module is the answer to each:
 *
 * - **it outlives its usefulness** — a link that still works a week later is a
 *   credential sitting in an inbox, a mail archive, a forwarded thread and
 *   every SMTP hop's logs. Hence {@link PASSWORD_RESET_TTL_BOUNDS_MS}: the
 *   configured lifetime is *clamped* into 30–60 minutes, so a deployment
 *   cannot widen it into a standing key, and the email states the real number.
 * - **it gets used twice** — the second use would be someone replaying a link
 *   out of a mailbox after the owner already reset. Hence
 *   {@link markPasswordResetTokenUsed} and the `used_at` check in
 *   {@link inspectPasswordResetToken}: redemption is one-shot.
 * - **it piles up** — a user who clicks "forgot password" five times must not
 *   end up with five working links, four of which they have forgotten about.
 *   Hence {@link selectSupersededTokenIds}: issuing a token kills every other
 *   unused one for that user, so there is exactly one live link per account.
 *
 * ### What this module deliberately does NOT decide
 *
 * Whether the *account* may be reset at all (role, activation, tenant
 * lifecycle) is `PasswordResetService`'s call, not the token's — a token
 * policy that also knew about roles would be a second, quieter copy of the
 * authorization rules. And rate limiting lives in the `password_reset_public`
 * policy (`config/rate-limit.config.ts`), because a throttle has to run before
 * any database work, i.e. before any token exists.
 */

/** One minute, in milliseconds. Spelled out so the bounds below read clearly. */
const MINUTE_MS = 60_000;

/**
 * Hard bounds on the configured token lifetime.
 *
 * A reset link is a bearer credential delivered over email, a channel nobody
 * controls end to end. The floor exists because a link shorter than half an
 * hour fails real people — mail is queued, greylisted, read on a phone that
 * was in a bag. The ceiling exists because everything past an hour is pure
 * exposure: the link is already in an archive, and the user who asked for it
 * has either used it or given up.
 *
 * {@link resolvePasswordResetTtlMs} clamps into this band rather than
 * rejecting, so a mistyped environment variable degrades to a safe lifetime
 * instead of breaking password reset for a whole deployment. The email states
 * the resolved number, so what the recipient reads is always what the server
 * will honour.
 */
export const PASSWORD_RESET_TTL_BOUNDS_MS = {
  min: 30 * MINUTE_MS,
  max: 60 * MINUTE_MS,
} as const;

/**
 * Shipped default lifetime: 45 minutes, the middle of the band.
 *
 * Long enough that a mail round trip plus a distracted human is comfortable,
 * short enough that a forwarded thread is stale by the time anyone reads it.
 */
export const PASSWORD_RESET_DEFAULT_TTL_MS = 45 * MINUTE_MS;

/**
 * How long a spent or expired row is kept before the next mint sweeps it.
 *
 * Keeping dead rows for a day means a user who clicks an already-used link
 * gets the honest "this link is no longer valid" rather than a bare "unknown
 * token", and an administrator investigating a reset still has the
 * `requested_ip` of the attempt. Past that, the row is noise — the audit log
 * is the durable record, not this table.
 */
export const PASSWORD_RESET_RETENTION_MS = 24 * 60 * MINUTE_MS;

/**
 * Resolves a configured lifetime into the honoured one.
 *
 * Anything unusable (absent, empty, non-numeric, zero, negative) falls back to
 * {@link PASSWORD_RESET_DEFAULT_TTL_MS}; anything outside the band is clamped
 * into it. Accepts the raw string form too, so a config layer can hand over
 * `process.env.X` untouched.
 */
export function resolvePasswordResetTtlMs(raw: string | number | null | undefined): number {
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw.trim(), 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PASSWORD_RESET_DEFAULT_TTL_MS;
  }
  return Math.min(
    PASSWORD_RESET_TTL_BOUNDS_MS.max,
    Math.max(PASSWORD_RESET_TTL_BOUNDS_MS.min, Math.trunc(parsed)),
  );
}

/**
 * The lifetime as whole minutes, for the sentence the email actually prints.
 *
 * Derived rather than typed into the template, so "expires in N minutes" can
 * never drift away from the TTL the server enforces.
 */
export function passwordResetTtlMinutes(ttlMs: number): number {
  return Math.max(1, Math.round(ttlMs / MINUTE_MS));
}

/** Absolute expiry instant of a token minted at `now`. */
export function passwordResetExpiryAt(now: number, ttlMs: number): Date {
  return new Date(now + ttlMs);
}

/**
 * The persisted shape this policy reasons about.
 *
 * Structural, not the Sequelize model: the spec constructs plain objects and
 * the service passes real rows, and both satisfy it. `token_hash` is
 * deliberately absent — matching the digest is the *lookup*, and a policy that
 * also took the secret could accidentally make a decision out of it.
 */
export interface PasswordResetTokenRecord {
  id?: string;
  user_id?: string;
  expires_at: Date | string | number;
  used_at: Date | string | number | null;
}

/** Why a presented reset token was refused (or `ok` when it was not). */
export type PasswordResetTokenRejection = 'not_found' | 'expired' | 'already_used';

/** Verdict on one presented reset token. */
export type PasswordResetTokenDecision =
  | { usable: true; reason: 'ok' }
  | { usable: false; reason: PasswordResetTokenRejection };

/** Milliseconds of a `Date | string | number`, or `NaN` when unreadable. */
function instant(value: Date | string | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return value;
  }
  return new Date(value).getTime();
}

/**
 * Decides whether a looked-up token may be redeemed at `now`.
 *
 * Order matters: **used before expired**. A link that was spent and then sat
 * around until it also aged out is, to the person clicking it, a link they
 * already used — and to an investigator, a replay. Reporting `expired` there
 * would quietly hide the more interesting fact.
 *
 * A row with an unreadable `expires_at` is treated as expired rather than
 * usable: a corrupted timestamp must never widen a credential's life.
 *
 * Note that the *caller* must not turn these reasons into different HTTP
 * responses — `PasswordResetService` maps every rejection onto one generic
 * message, because "expired" versus "never existed" narrows an attacker's
 * search. The distinction exists for logs and tests.
 */
export function inspectPasswordResetToken(
  record: PasswordResetTokenRecord | null | undefined,
  now: number,
): PasswordResetTokenDecision {
  if (!record) {
    return { usable: false, reason: 'not_found' };
  }
  if (record.used_at !== null && record.used_at !== undefined) {
    return { usable: false, reason: 'already_used' };
  }
  const expiresAt = instant(record.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { usable: false, reason: 'expired' };
  }
  return { usable: true, reason: 'ok' };
}

/** Convenience predicate over {@link inspectPasswordResetToken}. */
export function isPasswordResetTokenUsable(
  record: PasswordResetTokenRecord | null | undefined,
  now: number,
): boolean {
  return inspectPasswordResetToken(record, now).usable;
}

/** The `used_at` write that spends (or supersedes) a token. */
export function markPasswordResetTokenUsed(now: number): { used_at: Date } {
  return { used_at: new Date(now) };
}

/**
 * Ids of the tokens a fresh mint must kill: **every** other unused row of that
 * user, expired or not.
 *
 * "One active link at a time" is the whole rule. Note that already-expired
 * unused rows are included: they are harmless on their own, but marking them
 * used is what makes `used_at IS NULL` mean exactly "the current link", which
 * is the invariant the reissue test asserts and the purge relies on.
 *
 * `exceptId` lets a caller exclude the row it just created, so the function is
 * safe to run after the insert as well as before it.
 */
export function selectSupersededTokenIds(
  records: ReadonlyArray<PasswordResetTokenRecord>,
  options: { exceptId?: string | null } = {},
): string[] {
  const except = options.exceptId ?? null;
  const ids: string[] = [];
  for (const record of records) {
    if (typeof record.id !== 'string' || record.id === except) {
      continue;
    }
    if (record.used_at === null || record.used_at === undefined) {
      ids.push(record.id);
    }
  }
  return ids;
}

/**
 * True when a row carries no information worth keeping: it is dead (spent or
 * expired) and has been dead for longer than {@link PASSWORD_RESET_RETENTION_MS}.
 *
 * Used by the sweep the next mint performs, which is why this table needs no
 * entry in the retention worker: a reset row's life is measured in minutes and
 * every new request cleans up after the previous ones.
 */
export function isPasswordResetTokenPurgeable(
  record: PasswordResetTokenRecord,
  now: number,
  retentionMs: number = PASSWORD_RESET_RETENTION_MS,
): boolean {
  const usedAt = record.used_at === null || record.used_at === undefined ? null : instant(record.used_at);
  const expiresAt = instant(record.expires_at);
  const deadAt = usedAt !== null && Number.isFinite(usedAt) ? Math.min(usedAt, expiresAt) : expiresAt;
  if (!Number.isFinite(deadAt)) {
    // An unreadable timestamp is not a licence to delete evidence.
    return false;
  }
  return now - deadAt >= retentionMs;
}
