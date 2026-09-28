import { registerAs } from '../framework';

/**
 * Marketing communications configuration.
 *
 * ```text
 * MARKETING_ADMIN_EMAILS        comma-separated — where system alerts,
 *                               campaign failure alerts, test emails and demo
 *                               lead notifications are sent
 * MARKETING_TEST_RECIPIENTS     comma-separated — the ONLY addresses a test
 *                               send may go to
 * MARKETING_WORKER_ENABLED      false → never schedule the campaign worker
 * MARKETING_WORKER_INTERVAL_MS  sweep cadence (default 60000: every minute)
 * MARKETING_WORKER_INITIAL_DELAY_MS  delay before the first sweep (default 30000)
 * MARKETING_BATCH_SIZE          recipients claimed per sweep (default 25)
 * MARKETING_RATE_PER_MINUTE     hard ceiling of messages handed to the relay
 *                               in any rolling minute (default 60)
 * MARKETING_CONCURRENCY         messages in flight at once (default 3)
 * MARKETING_SEND_DELAY_MS       base pause between sends (default 250)
 * MARKETING_SEND_JITTER_MS      random extra pause, 0..n (default 250)
 * MARKETING_MAX_ATTEMPTS        recipient attempts before terminal FAIL
 *                               (default 5)
 * MARKETING_RETRY_BASE_MS       first retry delay; doubles per attempt,
 *                               capped at 15 min (default 60000)
 * MARKETING_EXPIRY_MS           how long after `scheduled_at` a campaign may
 *                               still deliver (default 72h)
 * MARKETING_LEASE_MS            how long a claimed row stays leased before a
 *                               crashed worker's claim is recoverable
 *                               (default 120000)
 * ```
 *
 * `MARKETING_WORKER_BATCH_SIZE`, `MARKETING_DELIVERY_MAX_ATTEMPTS` and
 * `MARKETING_DELIVERY_BASE_BACKOFF_MS` remain accepted as the Session 2
 * spellings of `MARKETING_BATCH_SIZE`, `MARKETING_MAX_ATTEMPTS` and
 * `MARKETING_RETRY_BASE_MS` so an existing `.env` keeps working; the new
 * names win when both are set.
 *
 * ### Recipient policy (who may receive what)
 *
 * Two strictly separated rails, both configured here and nowhere else:
 *
 * - **Super Admin notifications** (`MARKETING_ADMIN_EMAILS`) — test emails,
 *   demo lead notifications, campaign failure alerts and system alerts.
 *   These are *operational* mail to the platform operator.
 * - **Campaign recipients** — only the school addresses produced by the
 *   server-side audience snapshot. A campaign email is never automatically
 *   copied to the Super Admin: doing so would put a live recipient list in a
 *   forwarded/shared mailbox and distort engagement analytics.
 *
 * Neither list is ever hard-coded in business logic. The addresses live in
 * the environment (see `web/.env.example`); this module only parses them.
 *
 * ### Test sending is closed by construction
 *
 * A test send may only target an address on `MARKETING_TEST_RECIPIENTS` —
 * `isMarketingTestRecipient()` is the single gate the (Phase 3) test-send
 * endpoint must use. The browser never supplies an arbitrary address, and
 * `MARKETING_TEST_RECIPIENTS` is the only way to widen the set.
 *
 * ### SMTP settings live in the `email` namespace
 *
 * `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` /
 * `EMAIL_FROM` are already typed in `email.config.ts` and are **shared** by
 * every outbound rail (password reset today, marketing Phase 3+). They are
 * deliberately not duplicated here: one relay, one typed source, one
 * fallback (`NoOpEmailProvider`) when incomplete.
 *
 * **Security:** this module parses no secrets. `SMTP_PASS` is read once by
 * `email.config.ts`, handed to nodemailer, and never logged, echoed or
 * persisted.
 */

/** RFC-bound for a single email address. */
const MAX_EMAIL_LENGTH = 254;

/** Conservative shape check — full RFC 5322 is not worth the false negatives. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Parses a comma-separated list of email addresses into normalized form. */
export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of raw.split(/[;,]/)) {
    const email = entry.trim().toLowerCase();
    if (
      email.length >= 3 &&
      email.length <= MAX_EMAIL_LENGTH &&
      EMAIL_PATTERN.test(email) &&
      !seen.has(email)
    ) {
      seen.add(email);
    }
  }
  return [...seen];
}

/**
 * The single gate for test-send addressing: `true` only when the (normalized)
 * address is on the configured `MARKETING_TEST_RECIPIENTS` list.
 *
 * Deliberately case-insensitive and whitespace-tolerant — and deliberately
 * *not* a substring or domain match: `marketing@school.edu` being a test
 * recipient must never make `principal@marketing.school.edu` one.
 */
export function isMarketingTestRecipient(
  email: string,
  allowedRecipients: readonly string[],
): boolean {
  const normalized = email.trim().toLowerCase();
  return allowedRecipients.some((allowed) => allowed.trim().toLowerCase() === normalized);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Like {@link positiveInt} but `0` is a legal value (delays and jitter). */
function nonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** First non-empty of the accepted spellings (new name wins). */
function firstSet(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== '');
}

export default registerAs('marketing', () => ({
  /** Super Admin notification addresses (operational mail). */
  adminEmails: parseEmailList(process.env.MARKETING_ADMIN_EMAILS),
  /** The closed allowlist a test send may target. */
  testRecipients: parseEmailList(process.env.MARKETING_TEST_RECIPIENTS),
  /** Background campaign worker knobs (mirrors the outbox worker's set). */
  worker: {
    enabled: process.env.MARKETING_WORKER_ENABLED?.trim().toLowerCase() !== 'false',
    intervalMs: positiveInt(process.env.MARKETING_WORKER_INTERVAL_MS, 60_000),
    initialDelayMs: nonNegativeInt(process.env.MARKETING_WORKER_INITIAL_DELAY_MS, 30_000),
    batchSize: positiveInt(
      firstSet(process.env.MARKETING_BATCH_SIZE, process.env.MARKETING_WORKER_BATCH_SIZE),
      25,
    ),
  },
  /**
   * Recipient delivery policy: bounded attempts, exponential backoff with
   * jitter, a rolling per-minute ceiling, bounded concurrency and a delivery
   * window after which a campaign stops sending entirely.
   */
  delivery: {
    maxAttempts: positiveInt(
      firstSet(process.env.MARKETING_MAX_ATTEMPTS, process.env.MARKETING_DELIVERY_MAX_ATTEMPTS),
      5,
    ),
    baseBackoffMs: positiveInt(
      firstSet(process.env.MARKETING_RETRY_BASE_MS, process.env.MARKETING_DELIVERY_BASE_BACKOFF_MS),
      60_000,
    ),
    /** Durable defaults used when the singleton settings row is first created. */
    dailyCap: positiveInt(process.env.MARKETING_DAILY_SEND_CAP, 500),
    timezone: process.env.MARKETING_DELIVERY_TIMEZONE?.trim() || 'UTC',
    /** Messages handed to the relay per rolling minute (also DB-enforced globally). */
    ratePerMinute: positiveInt(process.env.MARKETING_RATE_PER_MINUTE, 60),
    /** Messages in flight at once inside one sweep. */
    concurrency: positiveInt(process.env.MARKETING_CONCURRENCY, 3),
    /** Base pause between two sends of the same worker slot. */
    sendDelayMs: nonNegativeInt(process.env.MARKETING_SEND_DELAY_MS, 250),
    /** Random extra pause (0..n) so parallel instances do not lock-step. */
    sendJitterMs: nonNegativeInt(process.env.MARKETING_SEND_JITTER_MS, 250),
    /** Delivery window measured from `scheduled_at` (default 72 hours). */
    expiryMs: positiveInt(process.env.MARKETING_EXPIRY_MS, 72 * 60 * 60 * 1000),
    /** Claim lease; an expired lease makes a `PROCESSING` row recoverable. */
    leaseMs: positiveInt(process.env.MARKETING_LEASE_MS, 120_000),
  },
}));
