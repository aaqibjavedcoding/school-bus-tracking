import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MarketingCampaignStatus,
  MarketingErrorCategory,
  MarketingRecipientStatus,
} from '@school-bus-tracking/shared-types';
import {
  buildCampaignCounters,
  chunk,
  classifyMarketingFailure,
  decideCampaignStatus,
  decideMarketingAttempt,
  isMarketingCampaignExpired,
  marketingBackoffMs,
  marketingSendPauseMs,
  MarketingRateWindow,
  MARKETING_MAX_BACKOFF_MS,
  outstandingRecipientCount,
  type MarketingCampaignCounters,
  type MarketingDeliveryPolicy,
} from './marketing-delivery.policy';

/**
 * The delivery *rules*, tested without a database, a clock or a relay.
 *
 * These functions decide whether a recipient is retried or abandoned, how
 * fast the relay is driven, and when a campaign is allowed to call itself
 * finished. Every assertion below corresponds to a way the system could
 * otherwise misbehave in a way nobody can undo: a duplicate send, a campaign
 * that reports "completed" while addresses are still queued, or a retry storm
 * against a relay that is already throttling us.
 */

const POLICY: MarketingDeliveryPolicy = {
  batchSize: 25,
  maxAttempts: 3,
  retryBaseMs: 60_000,
  ratePerMinute: 60,
  concurrency: 3,
  sendDelayMs: 200,
  sendJitterMs: 100,
  expiryMs: 72 * 60 * 60 * 1000,
  leaseMs: 120_000,
};

const NOW = new Date('2026-09-27T10:00:00.000Z');

function counters(overrides: Partial<MarketingCampaignCounters> = {}): MarketingCampaignCounters {
  return {
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
    ...overrides,
  };
}

describe('marketingBackoffMs', () => {
  it('doubles the window per attempt', () => {
    // `random() === 1` picks the top of the full-jitter window, which is the
    // deterministic way to observe the exponential growth.
    const top = () => 1;
    assert.equal(marketingBackoffMs(1000, 1, top), 1000);
    assert.equal(marketingBackoffMs(1000, 2, top), 2000);
    assert.equal(marketingBackoffMs(1000, 3, top), 4000);
    assert.equal(marketingBackoffMs(1000, 4, top), 8000);
  });

  it('caps the window so a long-failing row does not drift out of the day', () => {
    assert.equal(marketingBackoffMs(60_000, 20, () => 1), MARKETING_MAX_BACKOFF_MS);
  });

  it('applies full jitter inside the window', () => {
    // Same attempt, different randomness → different delays. Without this,
    // every recipient of a throttled campaign would retry in lock-step and
    // reproduce the burst that caused the throttle.
    const low = marketingBackoffMs(60_000, 3, () => 0.1);
    const high = marketingBackoffMs(60_000, 3, () => 0.9);
    assert.ok(low < high, 'jitter must spread retries across the window');
    assert.ok(high <= 60_000 * 4, 'jitter never exceeds the window');
  });

  it('never returns a delay below one second', () => {
    // `random() === 0` would mean "retry immediately", i.e. a tight loop
    // against a relay that just refused us.
    assert.equal(marketingBackoffMs(60_000, 1, () => 0), 1000);
  });

  it('falls back to a sane base when configuration is nonsense', () => {
    assert.ok(marketingBackoffMs(Number.NaN, 1, () => 1) > 0);
    assert.ok(marketingBackoffMs(-5, 1, () => 1) > 0);
  });
});

describe('marketingSendPauseMs', () => {
  it('is the base delay plus bounded jitter', () => {
    assert.equal(marketingSendPauseMs(POLICY, () => 0), 200);
    assert.equal(marketingSendPauseMs(POLICY, () => 1), 300);
  });
});

describe('classifyMarketingFailure', () => {
  it('maps the provider verdict onto the two safe categories', () => {
    assert.equal(
      classifyMarketingFailure({ success: false, retryable: true, provider: 'smtp' }),
      MarketingErrorCategory.TRANSIENT,
    );
    assert.equal(
      classifyMarketingFailure({ success: false, retryable: false, provider: 'smtp' }),
      MarketingErrorCategory.PERMANENT,
    );
  });
});

describe('decideMarketingAttempt', () => {
  it('treats a successful send as terminal with no next attempt', () => {
    const decision = decideMarketingAttempt({
      outcome: { success: true, retryable: false, provider: 'smtp', messageId: 'abc' },
      attemptNumber: 1,
      policy: POLICY,
      now: NOW,
    });
    assert.equal(decision.status, MarketingRecipientStatus.SENT);
    assert.equal(decision.nextAttemptAt, null);
    assert.equal(decision.errorCategory, null);
  });

  it('retries a transient (SMTP 4xx / network) failure with backoff', () => {
    const decision = decideMarketingAttempt({
      outcome: { success: false, retryable: true, provider: 'smtp' },
      attemptNumber: 1,
      policy: POLICY,
      now: NOW,
      random: () => 1,
    });
    assert.equal(decision.status, MarketingRecipientStatus.RETRYING);
    assert.equal(decision.errorCategory, MarketingErrorCategory.TRANSIENT);
    assert.equal(decision.nextAttemptAt?.getTime(), NOW.getTime() + 60_000);
    assert.equal(decision.attemptsExhausted, false);
  });

  it('never retries a permanent (SMTP 5xx) rejection, even on attempt 1', () => {
    // Retrying an address the relay refused outright does not make it
    // deliverable — it makes the sending domain look like a spammer.
    const decision = decideMarketingAttempt({
      outcome: { success: false, retryable: false, provider: 'smtp' },
      attemptNumber: 1,
      policy: POLICY,
      now: NOW,
    });
    assert.equal(decision.status, MarketingRecipientStatus.FAILED);
    assert.equal(decision.nextAttemptAt, null);
    assert.equal(decision.errorCategory, MarketingErrorCategory.PERMANENT);
    assert.equal(decision.attemptsExhausted, false, 'a 5xx is not an exhausted budget');
  });

  it('stops retrying once the attempt budget is spent and flags it for alerting', () => {
    const decision = decideMarketingAttempt({
      outcome: { success: false, retryable: true, provider: 'smtp' },
      attemptNumber: POLICY.maxAttempts,
      policy: POLICY,
      now: NOW,
    });
    assert.equal(decision.status, MarketingRecipientStatus.FAILED);
    assert.equal(decision.nextAttemptAt, null);
    assert.equal(decision.attemptsExhausted, true);
  });
});

describe('buildCampaignCounters', () => {
  it('folds grouped rows into every counter the console shows', () => {
    const result = buildCampaignCounters([
      { status: MarketingRecipientStatus.PENDING, count: 4 },
      { status: MarketingRecipientStatus.PROCESSING, count: 1 },
      { status: MarketingRecipientStatus.SENT, count: 10, clicks: 7, uniqueClicks: 3, unsubscribes: 1 },
      { status: MarketingRecipientStatus.RETRYING, count: 2 },
      { status: MarketingRecipientStatus.FAILED, count: 3 },
      { status: MarketingRecipientStatus.BOUNCED, count: 1 },
      { status: MarketingRecipientStatus.SUPPRESSED, count: 5 },
      { status: MarketingRecipientStatus.SKIPPED, count: 1 },
      { status: MarketingRecipientStatus.CANCELLED, count: 2 },
      { status: MarketingRecipientStatus.EXPIRED, count: 1 },
    ]);

    assert.equal(result.recipient_count, 30);
    assert.equal(result.queued_count, 4);
    assert.equal(result.processing_count, 1);
    assert.equal(result.sent_count, 10);
    assert.equal(result.retrying_count, 2);
    assert.equal(result.failed_count, 4, 'bounced rows are failures for the operator');
    assert.equal(result.suppressed_count, 5);
    assert.equal(result.skipped_count, 1);
    assert.equal(result.cancelled_count, 2);
    assert.equal(result.expired_count, 1);
    assert.equal(result.total_click_count, 7);
    assert.equal(result.clicked_count, 3, 'unique clicks come from first_clicked_at');
    assert.equal(result.unsubscribed_count, 1);
  });

  it('parses PostgreSQL bigint strings and refuses negative values', () => {
    // COUNT(*) arrives as a string over the wire; a negative counter is not a
    // state the UI should ever have to render.
    const result = buildCampaignCounters([
      { status: MarketingRecipientStatus.SENT, count: '12' as unknown as number, clicks: '4' as unknown as number },
      { status: MarketingRecipientStatus.PENDING, count: -3 },
    ]);
    assert.equal(result.sent_count, 12);
    assert.equal(result.total_click_count, 4);
    assert.equal(result.queued_count, 0);
  });

  it('is idempotent — recomputing the same rows cannot double-count', () => {
    const rows = [{ status: MarketingRecipientStatus.SENT, count: 5, clicks: 2, uniqueClicks: 2 }];
    assert.deepEqual(buildCampaignCounters(rows), buildCampaignCounters(rows));
  });
});

describe('decideCampaignStatus', () => {
  it('never completes a campaign while work is outstanding', () => {
    const next = decideCampaignStatus(
      MarketingCampaignStatus.SENDING,
      counters({ recipient_count: 10, sent_count: 9, queued_count: 1 }),
    );
    assert.equal(next, null, 'one queued recipient blocks completion');
  });

  it('moves a scheduled campaign to sending once the first attempt lands', () => {
    const next = decideCampaignStatus(
      MarketingCampaignStatus.SCHEDULED,
      counters({ recipient_count: 5, sent_count: 1, queued_count: 4 }),
    );
    assert.equal(next, MarketingCampaignStatus.SENDING);
  });

  it('completes only when every recipient is terminal and none hard-failed', () => {
    const next = decideCampaignStatus(
      MarketingCampaignStatus.SENDING,
      counters({ recipient_count: 6, sent_count: 5, suppressed_count: 1 }),
    );
    assert.equal(next, MarketingCampaignStatus.COMPLETED);
  });

  it('reports partial failure when some recipients failed or expired', () => {
    assert.equal(
      decideCampaignStatus(
        MarketingCampaignStatus.SENDING,
        counters({ recipient_count: 10, sent_count: 8, failed_count: 2 }),
      ),
      MarketingCampaignStatus.PARTIALLY_FAILED,
    );
    assert.equal(
      decideCampaignStatus(
        MarketingCampaignStatus.SENDING,
        counters({ recipient_count: 10, sent_count: 9, expired_count: 1 }),
      ),
      MarketingCampaignStatus.PARTIALLY_FAILED,
    );
  });

  it('reports total failure when nothing was delivered at all', () => {
    assert.equal(
      decideCampaignStatus(
        MarketingCampaignStatus.SENDING,
        counters({ recipient_count: 4, failed_count: 4 }),
      ),
      MarketingCampaignStatus.FAILED,
    );
  });

  it('never overwrites an operator decision or a terminal state', () => {
    // Pause must survive a sweep, and cancel is final: the worker recomputes
    // counters for both, but it may not move the status back.
    for (const status of [
      MarketingCampaignStatus.PAUSED,
      MarketingCampaignStatus.CANCELLED,
      MarketingCampaignStatus.COMPLETED,
      MarketingCampaignStatus.PARTIALLY_FAILED,
      MarketingCampaignStatus.FAILED,
      MarketingCampaignStatus.DRAFT,
    ]) {
      assert.equal(
        decideCampaignStatus(status, counters({ recipient_count: 3, sent_count: 3 })),
        null,
        `${status} must not be rewritten by the worker`,
      );
    }
  });

  it('counts queued, processing and retrying as outstanding work', () => {
    assert.equal(
      outstandingRecipientCount(
        counters({ queued_count: 2, processing_count: 1, retrying_count: 3, sent_count: 99 }),
      ),
      6,
    );
  });
});

describe('MarketingRateWindow', () => {
  it('enforces the per-minute ceiling', () => {
    const window = new MarketingRateWindow(3);
    const t0 = 1_000_000;
    assert.equal(window.remaining(t0), 3);
    window.record(t0);
    window.record(t0 + 10);
    window.record(t0 + 20);
    assert.equal(window.remaining(t0 + 30), 0, 'the ceiling is reached');
  });

  it('is a rolling window, not a fixed bucket', () => {
    // A fixed window allows 2× the limit across its boundary (burst at the
    // end, burst at the start). Expiring individual timestamps does not.
    const window = new MarketingRateWindow(2);
    const t0 = 5_000_000;
    window.record(t0);
    window.record(t0 + 1000);
    assert.equal(window.remaining(t0 + 2000), 0);
    assert.equal(window.remaining(t0 + 60_001), 1, 'the oldest send has aged out');
    assert.equal(window.remaining(t0 + 61_001), 2);
  });

  it('reports how long until a slot frees up', () => {
    const window = new MarketingRateWindow(1);
    const t0 = 9_000_000;
    window.record(t0);
    assert.equal(window.retryAfterMs(t0 + 10_000), 50_000);
    assert.equal(window.retryAfterMs(t0 + 60_000), 0);
  });
});

describe('chunk', () => {
  it('bounds concurrency by splitting the batch', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it('never produces a zero-width chunk (which would spin forever)', () => {
    assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
  });
});

describe('isMarketingCampaignExpired', () => {
  it('closes the delivery window measured from the scheduled time', () => {
    const scheduled = new Date('2026-09-20T00:00:00.000Z');
    assert.equal(
      isMarketingCampaignExpired({ scheduled_at: scheduled }, POLICY, new Date('2026-09-22T00:00:00.000Z')),
      false,
    );
    assert.equal(
      isMarketingCampaignExpired({ scheduled_at: scheduled }, POLICY, new Date('2026-09-24T00:00:00.000Z')),
      true,
      'a week-old campaign must not suddenly mail people',
    );
  });

  it('never expires a campaign with no anchor timestamp', () => {
    assert.equal(isMarketingCampaignExpired({ scheduled_at: null }, POLICY, NOW), false);
  });
});
