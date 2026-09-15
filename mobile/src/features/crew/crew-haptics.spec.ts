import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HAPTICS_PATTERNS, hapticsFor, type HapticsEventKind } from './crew-haptics.ts';

/**
 * The vibration vocabulary (Phase 3b). Three shapes, reused consistently — see
 * the table in `crew-haptics.ts`. The load-bearing assertion is the last one:
 * **disabled means `null`, i.e. no native call at all.**
 */

const EVENTS = Object.keys(HAPTICS_PATTERNS) as HapticsEventKind[];

describe('haptic mapping', () => {
  test('board and drop success are a light impact', () => {
    for (const kind of ['board.done', 'board.queued', 'drop.done', 'drop.queued'] as const) {
      assert.deepEqual(HAPTICS_PATTERNS[kind], { call: 'impact', style: 'light' });
    }
  });

  test('trip lifecycle changes are a heavier impact than a row tap', () => {
    for (const kind of ['trip.boarding', 'trip.inProgress', 'trip.completed'] as const) {
      assert.deepEqual(HAPTICS_PATTERNS[kind], { call: 'impact', style: 'medium' });
    }
  });

  test('a rejection or a network failure is the error notification', () => {
    for (const kind of ['action.failed', 'action.conflict', 'sos.failed'] as const) {
      assert.deepEqual(HAPTICS_PATTERNS[kind], { call: 'notification', type: 'error' });
    }
  });

  /**
   * The deliberate decision, pinned so it cannot drift: **SOS fired = success,
   * not warning.** The haptic confirms *delivery*; "warning" is reserved for
   * "this did not go through", which is the one distinction a stressed driver
   * must never have to reason about. Queued (offline) is the warning state.
   */
  test('SOS: hold ticks, sent is success, queued is warning — three states, three patterns', () => {
    assert.deepEqual(HAPTICS_PATTERNS['sos.hold'], { call: 'selection' });
    assert.deepEqual(HAPTICS_PATTERNS['sos.sent'], { call: 'notification', type: 'success' });
    assert.deepEqual(HAPTICS_PATTERNS['sos.queued'], { call: 'notification', type: 'warning' });
    assert.notDeepEqual(HAPTICS_PATTERNS['sos.sent'], HAPTICS_PATTERNS['sos.queued']);
    assert.notDeepEqual(HAPTICS_PATTERNS['sos.sent'], HAPTICS_PATTERNS['sos.failed']);
  });

  test('controls use the selection tick, outcomes use notifications', () => {
    assert.deepEqual(HAPTICS_PATTERNS.toggle, { call: 'selection' });
    assert.deepEqual(HAPTICS_PATTERNS.test, { call: 'notification', type: 'success' });
    assert.deepEqual(HAPTICS_PATTERNS['sync.done'], { call: 'notification', type: 'success' });
  });

  test('every event has a pattern, and every pattern is one the adapter knows', () => {
    assert.ok(EVENTS.length >= 18, `expected the full event set, got ${EVENTS.length}`);
    for (const kind of EVENTS) {
      const pattern = HAPTICS_PATTERNS[kind];
      assert.ok(pattern, `${kind} has no pattern`);
      if (pattern.call === 'impact') {
        assert.ok(['light', 'medium'].includes(pattern.style), `${kind}: ${pattern.style}`);
      } else if (pattern.call === 'notification') {
        assert.ok(
          ['success', 'warning', 'error'].includes(pattern.type),
          `${kind}: ${pattern.type}`,
        );
      } else {
        assert.equal(pattern.call, 'selection');
      }
    }
  });
});

describe('vibration off ⇒ zero native calls', () => {
  test('hapticsFor returns null for every event when disabled', () => {
    for (const kind of EVENTS) {
      assert.equal(hapticsFor(kind, false), null, `${kind} vibrated while disabled`);
    }
  });

  test('and returns the mapped pattern for every event when enabled', () => {
    for (const kind of EVENTS) {
      assert.deepEqual(hapticsFor(kind, true), HAPTICS_PATTERNS[kind]);
    }
  });

  test('an unknown event is silent rather than a guessed buzz', () => {
    assert.equal(hapticsFor('not-an-event' as HapticsEventKind, true), null);
  });
});
