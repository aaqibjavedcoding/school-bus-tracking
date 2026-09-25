import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  HAPTIC_BY_EVENT,
  HAPTIC_MIN_GAP_MS,
  HapticPattern,
  HapticThrottle,
  UNTHROTTLED_PATTERNS,
  hapticFor,
  isUnthrottled,
} from './crew-haptics.ts';
import type { CrewFeedbackEvent, CrewFeedbackEventType } from './crew-voice.ts';

/**
 * The haptic vocabulary, as a table. Pure — no `expo-haptics` import anywhere
 * in this file's import graph, which is itself part of the contract (the
 * native call lives in `crew-feedback-native.ts` alone).
 */

const ALL_EVENTS: CrewFeedbackEventType[] = [
  'board.confirmed',
  'drop.confirmed',
  'action.rejected',
  'trip.boarding',
  'trip.inProgress',
  'trip.completed',
  'sos.holdStart',
  'sos.fired',
  'sos.queued',
  'offline.synced',
  'gps.on',
  'gps.off',
  // Batch 3C — the next-stop announcements.
  'stop.next',
  'stop.approaching',
  // N7 — the ~300 m proximity alert.
  'stop.near',
];

describe('the event → pattern table', () => {
  test('every event has exactly one declared pattern', () => {
    // The `Record<CrewFeedbackEventType, …>` type makes this a compile error
    // too; asserting it at runtime keeps the list honest if the type is ever
    // widened.
    for (const type of ALL_EVENTS) {
      assert.ok(HAPTIC_BY_EVENT[type], `${type} has no haptic`);
    }
    assert.equal(Object.keys(HAPTIC_BY_EVENT).length, ALL_EVENTS.length);
  });

  test('board/drop success is a LIGHT impact — the "recorded" feeling', () => {
    assert.equal(hapticFor({ type: 'board.confirmed', firstName: 'A' }), HapticPattern.light);
    assert.equal(hapticFor({ type: 'drop.confirmed', firstName: 'A' }), HapticPattern.light);
  });

  test('a rejection / 409 / network failure is an ERROR notification', () => {
    assert.equal(hapticFor({ type: 'action.rejected' }), HapticPattern.error);
  });

  test('SOS hold start is a selection tick, SOS fired is a SUCCESS notification', () => {
    assert.equal(hapticFor({ type: 'sos.holdStart' }), HapticPattern.selection);
    // Deliberate, and the reason is in the module doc: the pattern answers
    // "did my alert get out?", not "is everything fine?". Success is the
    // unambiguous "delivered".
    assert.equal(hapticFor({ type: 'sos.fired' }), HapticPattern.success);
  });

  test('SOS queued is WARNING — distinct from fired, because the outcome differs', () => {
    // Collapsing both onto one pattern would erase the only distinction that
    // matters at that moment: sent vs not-yet-sent.
    assert.equal(hapticFor({ type: 'sos.queued' }), HapticPattern.warning);
    assert.notEqual(
      hapticFor({ type: 'sos.queued' }),
      hapticFor({ type: 'sos.fired' }),
      'delivered and queued must feel different',
    );
  });

  test('the queue draining is a success buzz; GPS toggles are ticks', () => {
    assert.equal(hapticFor({ type: 'offline.synced', count: 4 }), HapticPattern.success);
    assert.equal(hapticFor({ type: 'gps.on' }), HapticPattern.selection);
    assert.equal(hapticFor({ type: 'gps.off' }), HapticPattern.selection);
  });

  test('trip transitions share the light "recorded" pattern', () => {
    for (const type of ['trip.boarding', 'trip.inProgress', 'trip.completed'] as const) {
      assert.equal(hapticFor({ type } as CrewFeedbackEvent), HapticPattern.light);
    }
  });

  test('a next-stop announcement is a light tap — information, not an outcome', () => {
    // Batch 3C: the crew did not ask for it, so it gets the lightest "something
    // happened" pattern. The tap also answers a question a driver cannot: was
    // that sentence the phone, or the road?
    for (const type of ['stop.next', 'stop.approaching'] as const) {
      const event = { type, stopName: 'Shivaji Chowk', studentCount: 12 } as CrewFeedbackEvent;
      assert.equal(hapticFor(event), HapticPattern.light);
      assert.ok(isUnthrottled(hapticFor(event)), 'a reminder must never be swallowed by a gate');
    }
  });
});

describe('haptic throttling', () => {
  test('light taps are NEVER throttled — the thumb is the metronome', () => {
    // Unlike speech, a 10 ms tap cannot overlap audibly, and suppressing it
    // would break the one-tap-one-confirmation loop fast boarding relies on.
    const throttle = new HapticThrottle();
    let fired = 0;
    for (let index = 0; index < 40; index += 1) {
      if (throttle.allow(HapticPattern.light, index * 25)) fired += 1;
    }
    assert.equal(fired, 40, '40 boards must produce 40 taps');
    assert.ok(isUnthrottled(HapticPattern.light));
    assert.ok(isUnthrottled(HapticPattern.selection));
  });

  test('long notification patterns are gated so two buzzes never slur', () => {
    const throttle = new HapticThrottle();
    assert.equal(throttle.allow(HapticPattern.error, 0), true);
    assert.equal(throttle.allow(HapticPattern.error, 100), false);
    assert.equal(throttle.allow(HapticPattern.success, HAPTIC_MIN_GAP_MS + 1), true);
  });

  test('reset re-arms the gate', () => {
    const throttle = new HapticThrottle();
    throttle.allow(HapticPattern.error, 0);
    throttle.reset();
    assert.equal(throttle.allow(HapticPattern.error, 1), true);
  });

  test('the unthrottled set is exactly the two short patterns', () => {
    assert.deepEqual(
      [...UNTHROTTLED_PATTERNS].sort(),
      [HapticPattern.light, HapticPattern.selection].sort(),
    );
  });
});
