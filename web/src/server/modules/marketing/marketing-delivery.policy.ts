/**
 * The pure half of marketing delivery: every decision the worker makes that
 * does not need a database, a clock of its own or a socket.
 *
 * Keeping backoff, failure classification, counter aggregation, campaign
 * status and the rate ceiling in framework-free functions is what makes the
 * worker testable under `node --test` (the repo has no Jest/Vitest) — the
 * same shape `outbox/delivery-policy.ts` uses for push, and for the same
 * reason. `marketing-delivery.worker.ts` owns the I/O; this file owns the
 * rules.
 */

import {
  MarketingCampaignStatus,
  MarketingErrorCategory,
  MarketingRecipientStatus,
} from '@school-bus-tracking/shared-types';

/** Everything the worker needs to know about how fast and how hard to try. */
export interface MarketingDeliveryPolicy {
  /** Recipients claimed per sweep. */
  batchSize: number;
  /** Attempts (including the first) before a row becomes terminally FAILED. */
  maxAttempts: number;
  /** First retry delay; doubles per attempt up to {@link MARKETING_MAX_BACKOFF_MS}. */
  retryBaseMs: number;
  /** Hard ceiling of messages handed to the relay per rolling minute. */
  ratePerMinute: number;
  /** Messages in flight at once. */
  concurrency: number;
  /** Base pause after a send. */
  sendDelayMs: number;
  /** Random extra pause, 0..n, added to `sendDelayMs`. */
  sendJitterMs: number;
  /** Delivery window measured from the campaign's `scheduled_at`. */
  expiryMs: number;
  /** Claim lease; a `PROCESSING` row past it is recoverable. */
  leaseMs: number;
}

/** Ceiling of the exponential backoff, per attempt. */
export const MARKETING_MAX_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Next retry delay for a 1-based attempt number: bounded exponential backoff
 * with **full jitter** (`random(0, base * 2^(n-1))`, capped).
 *
 * Jitter is not decoration. Every recipient of one campaign fails at the same
 * moment when a relay starts greylisting or rate-limiting, so a deterministic
 * backoff would re-deliver the whole batch in lock-step at exactly the same
 * later instant — the same thundering herd that caused the throttle, repeated
 * until the attempt budget runs out. Randomizing inside the window spreads
 * the retries across it and lets the relay drain.
 *
 * `random` is injectable so tests can pin the value; production passes
 * `Math.random`.
 */
export function marketingBackoffMs(
  baseMs: number,
  attemptNumber: number,
  random: () => number = Math.random,
): number {
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 60_000;
  const exponent = Math.max(0, attemptNumber - 1);
  const ceiling = Math.min(safeBase * 2 ** exponent, MARKETING_MAX_BACKOFF_MS);
  // Full jitter, but never below a second: a "retry immediately" is how a
  // transient relay failure turns into a tight loop.
  return Math.max(1000, Math.round(ceiling * clamp01(random())));
}

/** A randomized pause between two sends (rate smoothing, not backoff). */
export function marketingSendPauseMs(
  policy: Pick<MarketingDeliveryPolicy, 'sendDelayMs' | 'sendJitterMs'>,
  random: () => number = Math.random,
): number {
  const base = Math.max(0, policy.sendDelayMs);
  const jitter = Math.max(0, policy.sendJitterMs);
  return base + Math.round(jitter * clamp01(random()));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------- failures

/** The provider outcome the policy reasons about (never the raw error text). */
export interface MarketingSendOutcome {
  success: boolean;
  /** The provider's own retryability verdict (SMTP 4xx / network = true). */
  retryable: boolean;
  /** Provider-assigned message id, when the send succeeded. */
  messageId?: string | null;
  /** Provider name, for the safe log line. */
  provider: string;
}

/**
 * Maps a failed send onto the **safe category** that is allowed to reach the
 * database.
 *
 * What is deliberately not derived here: the provider's error string. An SMTP
 * transcript can contain the relay's credentials (in an AUTH failure echo),
 * internal hostnames, and — on a rejected message — parts of the body, which
 * for a marketing send includes the recipient's personalized unsubscribe
 * token. Persisting or logging it would defeat the whole token design, so the
 * worker stores this enum and nothing else.
 */
export function classifyMarketingFailure(outcome: MarketingSendOutcome): MarketingErrorCategory {
  if (outcome.success) {
    return MarketingErrorCategory.UNKNOWN;
  }
  return outcome.retryable ? MarketingErrorCategory.TRANSIENT : MarketingErrorCategory.PERMANENT;
}

/** The recipient-row transition one attempt produces. */
export interface MarketingAttemptDecision {
  status: MarketingRecipientStatus;
  /** When the worker may try again; `null` on every terminal status. */
  nextAttemptAt: Date | null;
  /** Safe failure classification, `null` on success. */
  errorCategory: MarketingErrorCategory | null;
  /** True when this attempt exhausted the retry budget (alert-worthy). */
  attemptsExhausted: boolean;
}

/**
 * Decides what happens to one recipient row after an attempt.
 *
 * - **Success** is terminal and final: a row that reached `SENT` is never
 *   claimed again, which is the whole point of writing the outcome in the
 *   same statement that releases the lease.
 * - **A permanent rejection** (SMTP 5xx for this recipient) is terminal
 *   immediately. Retrying an address the relay just refused does not make it
 *   deliverable; it makes the sending domain look like a spammer.
 * - **A transient failure** (SMTP 4xx, DNS, TLS, timeout) retries with
 *   jittered exponential backoff until the attempt budget is spent.
 */
export function decideMarketingAttempt(args: {
  outcome: MarketingSendOutcome;
  attemptNumber: number;
  policy: Pick<MarketingDeliveryPolicy, 'maxAttempts' | 'retryBaseMs'>;
  now: Date;
  random?: () => number;
}): MarketingAttemptDecision {
  const { outcome, attemptNumber, policy, now } = args;
  if (outcome.success) {
    return {
      status: MarketingRecipientStatus.SENT,
      nextAttemptAt: null,
      errorCategory: null,
      attemptsExhausted: false,
    };
  }

  const category = classifyMarketingFailure(outcome);
  if (category === MarketingErrorCategory.PERMANENT) {
    return {
      status: MarketingRecipientStatus.FAILED,
      nextAttemptAt: null,
      errorCategory: category,
      attemptsExhausted: false,
    };
  }

  if (attemptNumber >= policy.maxAttempts) {
    return {
      status: MarketingRecipientStatus.FAILED,
      nextAttemptAt: null,
      errorCategory: category,
      attemptsExhausted: true,
    };
  }

  const delay = marketingBackoffMs(policy.retryBaseMs, attemptNumber, args.random);
  return {
    status: MarketingRecipientStatus.RETRYING,
    nextAttemptAt: new Date(now.getTime() + delay),
    errorCategory: category,
    attemptsExhausted: false,
  };
}

// ---------------------------------------------------------------- counters

/** One `GROUP BY status` row of the recipient table. */
export interface MarketingRecipientStatusGroup {
  status: MarketingRecipientStatus | string;
  count: number;
  /** SUM(click_count) for the group. */
  clicks?: number;
  /** COUNT(first_clicked_at) for the group — unique clicks. */
  uniqueClicks?: number;
  /** COUNT(unsubscribed_at) for the group. */
  unsubscribes?: number;
}

/** The campaign's denormalized progress counters. */
export interface MarketingCampaignCounters {
  recipient_count: number;
  queued_count: number;
  processing_count: number;
  sent_count: number;
  retrying_count: number;
  failed_count: number;
  suppressed_count: number;
  skipped_count: number;
  cancelled_count: number;
  expired_count: number;
  clicked_count: number;
  total_click_count: number;
  unsubscribed_count: number;
}

const ZERO_COUNTERS: MarketingCampaignCounters = {
  recipient_count: 0,
  queued_count: 0,
  processing_count: 0,
  sent_count: 0,
  retrying_count: 0,
  failed_count: 0,
  suppressed_count: 0,
  skipped_count: 0,
  cancelled_count: 0,
  expired_count: 0,
  clicked_count: 0,
  total_click_count: 0,
  unsubscribed_count: 0,
};

/**
 * Folds `GROUP BY status` rows into the campaign's counters.
 *
 * Counters are **recomputed from the recipient rows**, never incremented in
 * place. That single decision removes a whole family of bugs at once: a
 * worker that crashes between "send" and "increment" cannot lose a count, a
 * restart cannot double one, two workers finishing the same campaign cannot
 * race, and no arithmetic path exists that could drive a counter below zero
 * (the values are derived from `COUNT(*)`, which is non-negative by
 * construction).
 */
export function buildCampaignCounters(
  groups: readonly MarketingRecipientStatusGroup[],
): MarketingCampaignCounters {
  const counters: MarketingCampaignCounters = { ...ZERO_COUNTERS };
  for (const group of groups) {
    const count = safeCount(group.count);
    counters.recipient_count += count;
    counters.total_click_count += safeCount(group.clicks);
    counters.clicked_count += safeCount(group.uniqueClicks);
    counters.unsubscribed_count += safeCount(group.unsubscribes);
    switch (group.status) {
      case MarketingRecipientStatus.PENDING:
        counters.queued_count += count;
        break;
      case MarketingRecipientStatus.PROCESSING:
        counters.processing_count += count;
        break;
      case MarketingRecipientStatus.SENT:
        counters.sent_count += count;
        break;
      case MarketingRecipientStatus.RETRYING:
        counters.retrying_count += count;
        break;
      case MarketingRecipientStatus.FAILED:
      case MarketingRecipientStatus.BOUNCED:
        counters.failed_count += count;
        break;
      case MarketingRecipientStatus.SUPPRESSED:
        counters.suppressed_count += count;
        break;
      case MarketingRecipientStatus.SKIPPED:
        counters.skipped_count += count;
        break;
      case MarketingRecipientStatus.CANCELLED:
        counters.cancelled_count += count;
        break;
      case MarketingRecipientStatus.EXPIRED:
        counters.expired_count += count;
        break;
      default:
        // An unknown status must not silently vanish from the total, but it
        // also must not be guessed into a bucket. It stays in
        // `recipient_count` only, which keeps "queued + … = total" honest by
        // being visibly short rather than invented.
        break;
    }
  }
  return counters;
}

/** `COUNT(*)` can arrive as a string from PostgreSQL; normalize defensively. */
function safeCount(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

/** Recipients that may still change: the campaign cannot complete yet. */
export function outstandingRecipientCount(counters: MarketingCampaignCounters): number {
  return counters.queued_count + counters.processing_count + counters.retrying_count;
}

/**
 * The campaign status implied by its counters.
 *
 * Rules that are *not* negotiable:
 *
 * - a campaign is never `COMPLETED` while any recipient is queued, processing
 *   or retrying — "done" must mean every snapshotted address reached a
 *   terminal state, not "the worker ran out of things to do this sweep";
 * - `PAUSED` and the terminal states are never overwritten by the worker.
 *   Pause is an operator's decision and must survive a sweep; cancelling is
 *   final.
 *
 * `null` means "leave the status alone".
 */
export function decideCampaignStatus(
  current: MarketingCampaignStatus,
  counters: MarketingCampaignCounters,
): MarketingCampaignStatus | null {
  if (
    current === MarketingCampaignStatus.PAUSED ||
    current === MarketingCampaignStatus.CANCELLED ||
    current === MarketingCampaignStatus.COMPLETED ||
    current === MarketingCampaignStatus.PARTIALLY_FAILED ||
    current === MarketingCampaignStatus.FAILED ||
    current === MarketingCampaignStatus.DRAFT
  ) {
    return null;
  }

  if (outstandingRecipientCount(counters) > 0) {
    // Work is still owed. A campaign that has already started shows as
    // running; one whose first recipient has not been attempted stays
    // scheduled.
    const started =
      counters.sent_count +
        counters.failed_count +
        counters.suppressed_count +
        counters.skipped_count +
        counters.expired_count +
        counters.processing_count >
      0;
    if (started && current === MarketingCampaignStatus.SCHEDULED) {
      return MarketingCampaignStatus.SENDING;
    }
    return null;
  }

  // Every recipient is terminal. An empty snapshot cannot be "completed"
  // either — there was nothing to deliver, and the scheduling endpoint
  // already refuses an empty audience, so this is a defensive branch.
  if (counters.recipient_count === 0) {
    return null;
  }
  const hardFailures = counters.failed_count + counters.expired_count;
  if (counters.sent_count === 0 && hardFailures > 0) {
    return MarketingCampaignStatus.FAILED;
  }
  if (hardFailures > 0) {
    return MarketingCampaignStatus.PARTIALLY_FAILED;
  }
  return MarketingCampaignStatus.COMPLETED;
}

// ------------------------------------------------------------- rate window

/**
 * A rolling-window send ceiling shared by every sweep of one process.
 *
 * Deliberately a *rolling* window rather than "batchSize per tick": a relay
 * enforces "N messages per minute", not "N per sweep", and a fixed-window
 * counter lets a burst at the end of one window plus a burst at the start of
 * the next exceed the limit by 2×. Keeping the send timestamps and expiring
 * them by age is the cheap, correct version.
 *
 * Cross-process the ceiling is per instance, like the rate-limit store's
 * memory backend; the worker's advisory lock keeps concurrent instances from
 * multiplying it in the common single-writer deployment.
 */
export class MarketingRateWindow {
  private readonly sends: number[] = [];

  constructor(
    private readonly limitPerMinute: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Drops timestamps that left the window. */
  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.sends.length > 0 && this.sends[0] <= cutoff) {
      this.sends.shift();
    }
  }

  /** How many more messages may be sent right now. */
  remaining(nowMs: number = Date.now()): number {
    this.prune(nowMs);
    return Math.max(0, this.limitPerMinute - this.sends.length);
  }

  /** Records one send. Call it for attempts that actually reached the relay. */
  record(nowMs: number = Date.now()): void {
    this.prune(nowMs);
    this.sends.push(nowMs);
  }

  /** Milliseconds until the window frees a slot (0 when one is free). */
  retryAfterMs(nowMs: number = Date.now()): number {
    this.prune(nowMs);
    if (this.sends.length < this.limitPerMinute) {
      return 0;
    }
    return Math.max(0, this.sends[0] + this.windowMs - nowMs);
  }
}

/**
 * Splits a list into bounded-size chunks — the worker's concurrency gate.
 *
 * Bounded concurrency is a delivery requirement, not a performance tweak: an
 * unbounded `Promise.all` over a batch opens one SMTP conversation per
 * recipient at once, which relays answer with "too many concurrent
 * connections" (a 4xx that would then be retried, amplifying the problem).
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const width = Math.max(1, Math.trunc(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += width) {
    chunks.push(items.slice(index, index + width));
  }
  return chunks;
}

/** True when the campaign's delivery window has closed. */
export function isMarketingCampaignExpired(
  campaign: { scheduled_at: Date | null; started_at?: Date | null },
  policy: Pick<MarketingDeliveryPolicy, 'expiryMs'>,
  now: Date,
): boolean {
  const anchor = campaign.scheduled_at ?? campaign.started_at ?? null;
  if (!anchor) {
    return false;
  }
  return now.getTime() > anchor.getTime() + policy.expiryMs;
}
