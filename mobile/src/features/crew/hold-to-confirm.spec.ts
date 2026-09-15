import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HOLD_DURATION_MS,
  HOLD_WINDOW_MAX_MS,
  HOLD_WINDOW_MIN_MS,
  HoldToConfirm,
  progressAt,
} from './hold-to-confirm.ts';

/**
 * Pins the hold-to-confirm contract the SOS button relies on. The controller
 * is driven with synthetic timestamps, so no timers are involved.
 */

test('the hold window sits inside the required 600–1200 ms', () => {
  assert.ok(HOLD_DURATION_MS >= HOLD_WINDOW_MIN_MS, `${HOLD_DURATION_MS}ms must be ≥ 600ms`);
  assert.ok(HOLD_DURATION_MS <= HOLD_WINDOW_MAX_MS, `${HOLD_DURATION_MS}ms must be ≤ 1200ms`);
});

test('releasing before the hold completes never fires', () => {
  const hold = new HoldToConfirm();
  hold.press(0);
  assert.deepEqual(hold.release(HOLD_DURATION_MS - 1), { fire: false });
  assert.equal(hold.currentPhase, 'idle');
  // A brush of 100 ms and a long-finger 899 ms are both cancelled.
  hold.press(10_000);
  assert.deepEqual(hold.release(10_100), { fire: false });
  assert.equal(hold.currentPhase, 'idle');
});

test('a completed hold fires exactly once and locks until reset', () => {
  const hold = new HoldToConfirm();
  assert.deepEqual(hold.press(0), { fire: false });
  assert.deepEqual(hold.complete(), { fire: true });
  // Double-press / second completion while the first is being handled:
  assert.deepEqual(hold.complete(), { fire: false });
  assert.deepEqual(hold.press(50), { fire: false });
  assert.deepEqual(hold.release(900), { fire: false });
  assert.deepEqual(hold.complete(), { fire: false });
  // Only an explicit reset (the action settled) re-arms the button.
  hold.reset();
  assert.deepEqual(hold.press(1_000), { fire: false });
  assert.deepEqual(hold.complete(), { fire: true });
});

test('an early release re-arms for a fresh full hold', () => {
  const hold = new HoldToConfirm();
  hold.press(0);
  hold.release(200);
  hold.press(1_000);
  assert.deepEqual(hold.complete(), { fire: true });
});

test('progress runs 0→1 across the hold and clamps outside it', () => {
  assert.equal(progressAt(-5), 0);
  assert.equal(progressAt(0), 0);
  assert.equal(progressAt(HOLD_DURATION_MS / 4), 0.25);
  assert.equal(progressAt(HOLD_DURATION_MS / 2), 0.5);
  assert.equal(progressAt(HOLD_DURATION_MS), 1);
  assert.equal(progressAt(HOLD_DURATION_MS * 10), 1);
});

test('snapshot reports the live hold progress and the fired lock', () => {
  const hold = new HoldToConfirm();
  assert.deepEqual(hold.snapshot(0), { phase: 'idle', progress: 0 });
  hold.press(100);
  const mid = hold.snapshot(100 + HOLD_DURATION_MS / 2);
  assert.equal(mid.phase, 'holding');
  assert.equal(mid.progress, 0.5);
  hold.complete();
  assert.deepEqual(hold.snapshot(999), { phase: 'fired', progress: 1 });
  hold.release(1_000);
  assert.equal(hold.currentPhase, 'fired', 'release must not unlock a fired hold');
});
