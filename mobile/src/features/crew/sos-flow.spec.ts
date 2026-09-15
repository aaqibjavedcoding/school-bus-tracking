import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SosSession, isQueueableSosError } from './sos-flow.ts';
import { ApiClientError } from '@school-bus-tracking/api-client';

/** Keys the spec can recognise. */
let counter = 0;
const nextKey = (): string => `key-${(counter += 1)}`;

test('every retry of one alert reuses the same idempotency key (double-press cannot duplicate)', () => {
  const session = new SosSession(nextKey);
  const first = session.beginAttempt();
  // A second press while the first request is still on the wire — the
  // existing SosPanel hands *both* requests this same key.
  const second = session.beginAttempt();
  const retry = session.beginAttempt();
  assert.equal(first, second);
  assert.equal(second, retry);
  assert.match(first, /^key-\d+$/);
});

test('the key rotates only after the server confirms the alert', () => {
  const session = new SosSession(nextKey);
  const key = session.beginAttempt();
  session.markSent();
  assert.equal(session.deliveryStatus, 'sent');
  assert.notEqual(session.idempotencyKey, key, 'a NEW alert must mint a NEW key');
  assert.match(session.idempotencyKey, /^key-\d+$/);
});

test('an offline attempt stays queued on the same key for the reconnect retry', () => {
  const session = new SosSession(nextKey);
  const key = session.beginAttempt();
  session.markQueued();
  assert.equal(session.deliveryStatus, 'queued');
  assert.equal(session.needsRetry, true);
  // The automatic retry (network back) must carry the very same key so the
  // server treats it as a replay of one alert, never a second one.
  assert.equal(session.beginAttempt(), key);
  session.markSent();
  assert.equal(session.needsRetry, false);
  assert.notEqual(session.idempotencyKey, key);
});

test('a server rejection surfaces as failed and keeps the key (Task-44 parity)', () => {
  const session = new SosSession(nextKey);
  const key = session.beginAttempt();
  session.markFailed();
  assert.equal(session.deliveryStatus, 'failed');
  assert.equal(session.needsRetry, false);
  assert.equal(session.idempotencyKey, key);
});

test('queueability is decided by the shared offline rule, not a copy', () => {
  // Network-level failures (status 0) queue; server decisions do not.
  const networkDown = new ApiClientError('Network request failed', 0);
  const rejected = new ApiClientError('Invalid alert', 400);
  assert.equal(isQueueableSosError(networkDown), true);
  assert.equal(isQueueableSosError(rejected), false);
  assert.equal(isQueueableSosError(new Error('aborted')), true);
});
