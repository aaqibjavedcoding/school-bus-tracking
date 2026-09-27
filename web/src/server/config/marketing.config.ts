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
 * MARKETING_WORKER_INTERVAL_MS  sweep cadence (default 15000)
 * MARKETING_WORKER_INITIAL_DELAY_MS  delay before the first sweep (default 30000)
 * MARKETING_WORKER_BATCH_SIZE   recipients processed per sweep (default 25)
 * MARKETING_DELIVERY_MAX_ATTEMPTS    recipient attempts before terminal FAIL
 *                                    (default 5)
 * MARKETING_DELIVERY_BASE_BACKOFF_MS first retry delay; doubles per attempt,
 *                                    capped at 15 min (default 60000)
 * ```
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

export default registerAs('marketing', () => ({
  /** Super Admin notification addresses (operational mail). */
  adminEmails: parseEmailList(process.env.MARKETING_ADMIN_EMAILS),
  /** The closed allowlist a test send may target. */
  testRecipients: parseEmailList(process.env.MARKETING_TEST_RECIPIENTS),
  /** Background campaign worker knobs (mirrors the outbox worker's set). */
  worker: {
    enabled: process.env.MARKETING_WORKER_ENABLED?.trim().toLowerCase() !== 'false',
    intervalMs: positiveInt(process.env.MARKETING_WORKER_INTERVAL_MS, 15_000),
    initialDelayMs: positiveInt(process.env.MARKETING_WORKER_INITIAL_DELAY_MS, 30_000),
    batchSize: positiveInt(process.env.MARKETING_WORKER_BATCH_SIZE, 25),
  },
  /** Recipient delivery policy (exponential backoff, bounded attempts). */
  delivery: {
    maxAttempts: positiveInt(process.env.MARKETING_DELIVERY_MAX_ATTEMPTS, 5),
    baseBackoffMs: positiveInt(process.env.MARKETING_DELIVERY_BASE_BACKOFF_MS, 60_000),
  },
}));
