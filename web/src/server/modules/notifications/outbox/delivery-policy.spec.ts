import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  backoffDelayMs,
  DELIVERY_MAX_BACKOFF_MS,
  decideDelivery,
  deliveryDedupKey,
  deliveryExpiry,
} from './delivery-policy';
import { emptyDeviceOutcome } from '../providers';

const POLICY = {
  maxAttempts: 8,
  baseBackoffMs: 2000,
  expiryMs: 600_000,
  batchSize: 50,
};

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
  it('adds the configured expiry window to the creation clock', () => {
    const createdAt = Date.UTC(2026, 8, 1, 6, 31, 0);
    const expiry = deliveryExpiry(createdAt, POLICY);
    assert.equal(expiry.getTime(), createdAt + 600_000);
  });
});

describe('delivery-policy: deliveryDedupKey', () => {
  it('joins type/trip/student/stop into a stable 64-char-max key', () => {
    const key = deliveryDedupKey({
      type: 'STUDENT_BOARDED',
      tripId: 'trip-1',
      studentId: 'student-1',
      stopId: 'stop-1',
    });
    assert.equal(key, 'STUDENT_BOARDED:trip-1:student-1:stop-1');

    const huge = deliveryDedupKey({
      type: 'STUDENT_BOARDED',
      tripId: 'x'.repeat(80),
      studentId: 'y'.repeat(80),
      stopId: 'z'.repeat(80),
    });
    assert.equal(huge.length, 64);
  });
});

describe('delivery-policy: decideDelivery', () => {
  it('marks sent when at least one device was accepted (partial success is sent)', () => {
    const decision = decideDelivery(
      { ...emptyDeviceOutcome(), delivered: ['tok-a'] },
      true,
      POLICY,
      1,
    );
    assert.deepEqual(decision, {
      status: 'sent',
      reason: null,
      kind: null,
      abandon: false,
      deliveredTokens: ['tok-a'],
    });
  });

  it('never claims sent from an empty outcome', () => {
    const decision = decideDelivery(emptyDeviceOutcome(), true, POLICY, 1);
    assert.equal(decision.status, 'failed');
  });

  it('retries a no-device row as transient until max attempts, then permanent+abandon', () => {
    const before = decideDelivery(emptyDeviceOutcome(), false, POLICY, 3);
    assert.equal(before.status, 'failed');
    assert.equal(before.kind, 'transient');
    assert.equal(before.abandon, false);

    const after = decideDelivery(emptyDeviceOutcome(), false, POLICY, POLICY.maxAttempts);
    assert.equal(after.kind, 'permanent');
    assert.equal(after.abandon, true);
  });

  it('retries retryable devices until max attempts', () => {
    const retryable = { ...emptyDeviceOutcome(), retryable: ['tok-a'] };
    const early = decideDelivery(retryable, true, POLICY, 2);
    assert.equal(early.kind, 'transient');
    assert.equal(early.abandon, false);

    const gaveUp = decideDelivery(retryable, true, POLICY, POLICY.maxAttempts);
    assert.equal(gaveUp.kind, 'permanent');
    assert.equal(gaveUp.abandon, true);
  });

  it('abandons as not_configured when every device lacks a provider (and none are invalid)', () => {
    const decision = decideDelivery(
      { ...emptyDeviceOutcome(), notConfigured: ['ios-tok'] },
      true,
      POLICY,
      1,
    );
    assert.equal(decision.status, 'not_configured');
    assert.equal(decision.kind, 'permanent');
    assert.equal(decision.abandon, true);
  });

  it('abandons permanently when every device token is invalid', () => {
    const decision = decideDelivery(
      { ...emptyDeviceOutcome(), invalid: ['tok-a', 'tok-b'] },
      true,
      POLICY,
      1,
    );
    assert.equal(decision.status, 'failed');
    assert.equal(decision.kind, 'permanent');
    assert.equal(decision.abandon, true);
  });
});
