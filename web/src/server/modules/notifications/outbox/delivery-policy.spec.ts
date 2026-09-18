import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  backoffDelayMs,
  DELIVERY_MAX_BACKOFF_MS,
  decideDelivery,
  deliveryDedupKey,
  deliveryExpiry,
  type DeliveryAttempt,
} from './delivery-policy';
import { emptyDeviceOutcome } from '../providers';

const POLICY = {
  maxAttempts: 8,
  baseBackoffMs: 2000,
  expiryMs: 600_000,
  batchSize: 50,
};

function attempt(overrides: Partial<DeliveryAttempt> = {}): DeliveryAttempt {
  return {
    attemptNumber: 1,
    attempted: [],
    outcome: emptyDeviceOutcome(),
    alreadyAccepted: [],
    dropped: [],
    hasActiveDevices: true,
    deadlinePassed: false,
    ...overrides,
  };
}

describe('delivery-policy: backoffDelayMs', () => {
  it('doubles per attempt from the base, starting at attempt 1', () => {
    assert.equal(backoffDelayMs(2000, 1), 2000);
    assert.equal(backoffDelayMs(2000, 2), 4000);
    assert.equal(backoffDelayMs(2000, 3), 8000);
    assert.equal(backoffDelayMs(2000, 4), 16000);
  });

  it('caps the delay at DELIVERY_MAX_BACKOFF_MS', () => {
    assert.equal(backoffDelayMs(2000, 10), DELIVERY_MAX_BACKOFF_MS);
    assert.ok(DELIVERY_MAX_BACKOFF_MS === 90_000);
  });

  it('sanitises a non-finite or non-positive base to the 2s default', () => {
    assert.equal(backoffDelayMs(Number.NaN, 2), 2000 * 2);
    assert.equal(backoffDelayMs(0, 2), 2000 * 2);
    assert.equal(backoffDelayMs(-5, 1), 2000);
  });
});

describe('delivery-policy: deliveryExpiry', () => {
  it('runs the window from the *event* clock, not the row creation time', () => {
    const eventAt = Date.UTC(2026, 8, 1, 6, 31, 0);
    const expiry = deliveryExpiry(eventAt, POLICY);
    assert.equal(expiry.getTime(), eventAt + 600_000);
  });

  it('does not refresh an old event created late (already past its window)', () => {
    const eventAt = Date.now() - 30 * 60 * 1000;
    const expiry = deliveryExpiry(eventAt, POLICY);
    assert.ok(expiry.getTime() < Date.now(), 'an obsolete event must expire immediately');
  });
});

describe('delivery-policy: deliveryDedupKey', () => {
  it('is a stable 64-char digest of the full event identity', () => {
    const key = deliveryDedupKey({
      type: 'STUDENT_BOARDED',
      tripId: 'trip-1',
      studentId: 'student-1',
      stopId: 'stop-1',
    });
    assert.equal(key.length, 64);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(
      key,
      deliveryDedupKey({
        type: 'STUDENT_BOARDED',
        tripId: 'trip-1',
        studentId: 'student-1',
        stopId: 'stop-1',
      }),
      'same event → same key',
    );
  });

  it('keeps identifiers that differ only after the old 64-char truncation distinct', () => {
    const sharedPrefix = 'x'.repeat(80);
    const keyA = deliveryDedupKey({
      type: 'STOP_ARRIVED',
      tripId: sharedPrefix,
      studentId: null,
      stopId: `${sharedPrefix}-stop-a`,
    });
    const keyB = deliveryDedupKey({
      type: 'STOP_ARRIVED',
      tripId: sharedPrefix,
      studentId: null,
      stopId: `${sharedPrefix}-stop-b`,
    });
    assert.notEqual(keyA, keyB, 'a truncated composite key would have collided here');
  });

  it('distinguishes every component (type/trip/student/stop)', () => {
    const base = { type: 'STOP_ARRIVED', tripId: 't', studentId: 's', stopId: 'p' };
    const keys = new Set([
      deliveryDedupKey(base),
      deliveryDedupKey({ ...base, type: 'STUDENT_BOARDED' }),
      deliveryDedupKey({ ...base, tripId: 't2' }),
      deliveryDedupKey({ ...base, studentId: 's2' }),
      deliveryDedupKey({ ...base, stopId: 'p2' }),
      deliveryDedupKey({ ...base, studentId: null }),
    ]);
    assert.equal(keys.size, 6);
  });
});

describe('delivery-policy: decideDelivery — complete vs partial success', () => {
  it('is complete only when every targeted device was accepted', () => {
    const decision = decideDelivery(
      attempt({
        attempted: ['tok-a', 'tok-b'],
        outcome: { ...emptyDeviceOutcome(), delivered: ['tok-a', 'tok-b'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'sent');
    assert.equal(decision.complete, true);
    assert.deepEqual(decision.acceptedTokens, ['tok-a', 'tok-b']);
    assert.deepEqual(decision.pendingTokens, []);
    assert.equal(decision.abandon, false);
  });

  it('keeps retrying the failed device while one device was already accepted', () => {
    const decision = decideDelivery(
      attempt({
        attemptNumber: 1,
        attempted: ['tok-a', 'tok-b'],
        outcome: { ...emptyDeviceOutcome(), delivered: ['tok-a'], retryable: ['tok-b'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'failed', 'the row is not finished yet');
    assert.equal(decision.kind, 'transient');
    assert.equal(decision.abandon, false);
    assert.deepEqual(decision.acceptedTokens, ['tok-a'], 'accepted device is persisted');
    assert.deepEqual(decision.pendingTokens, ['tok-b'], 'only the failed device is retried');
    assert.equal(decision.complete, false);
  });

  it('accumulates an accepted device across attempts instead of re-sending it', () => {
    const decision = decideDelivery(
      attempt({
        attemptNumber: 2,
        attempted: ['tok-b'],
        alreadyAccepted: ['tok-a'],
        outcome: { ...emptyDeviceOutcome(), delivered: ['tok-b'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'sent');
    assert.deepEqual(decision.acceptedTokens, ['tok-a', 'tok-b']);
    assert.deepEqual(decision.pendingTokens, []);
  });

  it('reports partial — never sent — when retries run out with a device undelivered', () => {
    const decision = decideDelivery(
      attempt({
        attemptNumber: POLICY.maxAttempts,
        attempted: ['tok-b'],
        alreadyAccepted: ['tok-a'],
        outcome: { ...emptyDeviceOutcome(), retryable: ['tok-b'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'partial');
    assert.equal(decision.kind, 'permanent');
    assert.equal(decision.abandon, true);
    assert.equal(decision.complete, false);
    assert.deepEqual(decision.acceptedTokens, ['tok-a']);
    assert.deepEqual(decision.pendingTokens, ['tok-b'], 'the undelivered device is recorded');
    assert.match(String(decision.reason), /Maximum delivery attempts/);
  });

  it('reports partial when the event window closes with a device undelivered', () => {
    const decision = decideDelivery(
      attempt({
        attemptNumber: 2,
        attempted: ['tok-b'],
        alreadyAccepted: ['tok-a'],
        outcome: { ...emptyDeviceOutcome(), retryable: ['tok-b'] },
        deadlinePassed: true,
      }),
      POLICY,
    );
    assert.equal(decision.status, 'partial');
    assert.equal(decision.abandon, true);
    assert.deepEqual(decision.acceptedTokens, ['tok-a']);
  });

  it('reports partial when one device is permanently rejected while another was accepted', () => {
    const decision = decideDelivery(
      attempt({
        attempted: ['tok-a', 'tok-stale'],
        outcome: {
          ...emptyDeviceOutcome(),
          delivered: ['tok-a'],
          invalid: ['tok-stale'],
        },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'partial');
    assert.equal(decision.complete, false);
    assert.deepEqual(decision.acceptedTokens, ['tok-a']);
    assert.deepEqual(decision.pendingTokens, []);
    assert.match(String(decision.reason), /invalid token/);
  });
});

describe('delivery-policy: decideDelivery — failure classification', () => {
  it('retries a device that failed transiently while another token was invalid (invalid never blocks)', () => {
    const decision = decideDelivery(
      attempt({
        attempted: ['tok-stale', 'tok-b'],
        outcome: {
          ...emptyDeviceOutcome(),
          invalid: ['tok-stale'],
          retryable: ['tok-b'],
        },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'failed');
    assert.equal(decision.kind, 'transient');
    assert.equal(decision.abandon, false);
    assert.deepEqual(decision.pendingTokens, ['tok-b']);
    assert.deepEqual(decision.acceptedTokens, []);
  });

  it('abandons permanently when every token is invalid', () => {
    const decision = decideDelivery(
      attempt({
        attempted: ['tok-a', 'tok-b'],
        outcome: { ...emptyDeviceOutcome(), invalid: ['tok-a', 'tok-b'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'failed');
    assert.equal(decision.kind, 'permanent');
    assert.equal(decision.abandon, true);
  });

  it('abandons as not_configured when every device lacks a provider', () => {
    const decision = decideDelivery(
      attempt({
        attempted: ['ios-tok'],
        outcome: { ...emptyDeviceOutcome(), notConfigured: ['ios-tok'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'not_configured');
    assert.equal(decision.kind, 'permanent');
    assert.equal(decision.abandon, true);
  });

  it('treats a provider misconfiguration as terminal without retiring the token', () => {
    const decision = decideDelivery(
      attempt({
        attemptNumber: 2,
        attempted: ['ios-tok'],
        outcome: {
          ...emptyDeviceOutcome(),
          misconfigured: ['ios-tok'],
          misconfiguredReason: 'InvalidProviderToken',
        },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'not_configured');
    assert.equal(decision.abandon, true);
    assert.deepEqual(decision.acceptedTokens, []);
    assert.deepEqual(decision.pendingTokens, ['ios-tok'], 'kept for audit, never deactivated');
    assert.match(String(decision.reason), /InvalidProviderToken/);
  });

  it('treats a permanently rejected message as terminal without touching the token', () => {
    const decision = decideDelivery(
      attempt({
        attemptNumber: 2,
        attempted: ['android-tok'],
        outcome: {
          ...emptyDeviceOutcome(),
          permanent: ['android-tok'],
          permanentReason: 'PayloadTooLarge',
        },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'failed');
    assert.equal(decision.kind, 'permanent');
    assert.equal(decision.abandon, true);
    assert.match(String(decision.reason), /PayloadTooLarge/);
  });

  it('treats a deadline-skipped device as terminal', () => {
    const decision = decideDelivery(
      attempt({
        attempted: ['tok-a'],
        outcome: { ...emptyDeviceOutcome(), expired: ['tok-a'] },
      }),
      POLICY,
    );
    assert.equal(decision.status, 'failed');
    assert.equal(decision.abandon, true);
  });

  it('retries a row whose recipient has no device yet, then abandons at the limit', () => {
    const noDevice = decideDelivery(attempt({ attempted: [], hasActiveDevices: false }), POLICY);
    assert.equal(noDevice.status, 'failed');
    assert.equal(noDevice.kind, 'transient');
    assert.equal(noDevice.abandon, false);

    const gaveUp = decideDelivery(
      attempt({ attemptNumber: POLICY.maxAttempts, attempted: [], hasActiveDevices: false }),
      POLICY,
    );
    assert.equal(gaveUp.kind, 'permanent');
    assert.equal(gaveUp.abandon, true);
  });

  it('never claims success when a provider forgets to account for an attempted token', () => {
    const decision = decideDelivery(attempt({ attempted: ['tok-a'] }), POLICY);
    assert.equal(decision.status, 'failed');
    assert.equal(decision.kind, 'transient');
    assert.deepEqual(decision.pendingTokens, ['tok-a']);
  });

  it('reports partial when an accepted row loses its remaining device to rotation', () => {
    const decision = decideDelivery(
      attempt({
        attempted: [],
        alreadyAccepted: ['tok-a'],
        dropped: ['tok-rotated'],
        hasActiveDevices: true,
      }),
      POLICY,
    );
    assert.equal(decision.status, 'partial');
    assert.equal(decision.abandon, true);
    assert.deepEqual(decision.acceptedTokens, ['tok-a']);
    assert.match(String(decision.reason), /no longer registered/);
  });
});
