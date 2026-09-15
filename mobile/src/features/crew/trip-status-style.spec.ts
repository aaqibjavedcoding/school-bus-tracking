import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TripStatus } from '@school-bus-tracking/shared-types';

import {
  MIN_STATE_COLOUR_DISTANCE,
  STATE_COLOURS,
  primaryTripAction,
  rgbDistance,
  stateWordContrast,
  tripStatusStyle,
} from './trip-status-style.ts';
import { AA_TEXT, contrastRatio } from '../../theme/contrast.ts';

/**
 * Guard for the Phase-2 giant status card: the background colour *is* the
 * state, so the mapping itself is load-bearing and pinned here —
 * which status maps to which colour family, that every state word stays
 * WCAG-AA on its background, and that the three state colours remain
 * distinguishable from a metre away (RGB-distance proxy, below).
 */

test('state → colour mapping is exactly the contract the crew was taught', () => {
  const bg = (status: TripStatus): string => tripStatusStyle(status).background;
  // BOARDING = green family, IN_PROGRESS = amber family, everything settled
  // or not-yet-started = grey family.
  assert.equal(bg(TripStatus.BOARDING), '#15803d');
  assert.equal(bg(TripStatus.IN_PROGRESS), '#b45309');
  assert.equal(bg(TripStatus.COMPLETED), bg(TripStatus.CANCELLED));
  assert.equal(bg(TripStatus.COMPLETED), bg(TripStatus.SCHEDULED));
  assert.notEqual(bg(TripStatus.BOARDING), bg(TripStatus.IN_PROGRESS));
});

test('every state word + icon keeps WCAG AA on its state background', () => {
  for (const status of Object.values(TripStatus)) {
    const ratio = stateWordContrast(status);
    assert.ok(
      ratio >= AA_TEXT,
      `${status}: state word contrast ${ratio.toFixed(2)}:1 < ${AA_TEXT}:1`,
    );
  }
  // The three state colours with their shared white foreground, spelled out
  // so the docs table and the code cannot drift apart.
  assert.ok(Math.abs(contrastRatio('#ffffff', '#15803d') - 5.01) < 0.05);
  assert.ok(Math.abs(contrastRatio('#ffffff', '#b45309') - 5.02) < 0.05);
  assert.ok(contrastRatio('#ffffff', '#475569') >= 4.5);
});

test('the state colours are distinguishable at arm’s length (RGB-distance proxy)', () => {
  assert.equal(STATE_COLOURS.length, 3, 'green / amber / grey');
  for (let a = 0; a < STATE_COLOURS.length; a += 1) {
    for (let b = a + 1; b < STATE_COLOURS.length; b += 1) {
      const distance = rgbDistance(STATE_COLOURS[a]!, STATE_COLOURS[b]!);
      assert.ok(
        distance >= MIN_STATE_COLOUR_DISTANCE,
        `${STATE_COLOURS[a]} vs ${STATE_COLOURS[b]}: distance ${distance.toFixed(0)} < ${MIN_STATE_COLOUR_DISTANCE}`,
      );
    }
  }
});

test('colour is never the only cue: every status has a distinct word and icon', () => {
  const seen = new Map<string, string>();
  for (const status of Object.values(TripStatus)) {
    const style = tripStatusStyle(status);
    const signature = `${style.word}|${style.icon}`;
    assert.ok(!seen.has(signature), `${status} shares word+icon with ${seen.get(signature)}`);
    seen.set(signature, status);
  }
});

test('exactly one primary action per state — the screen shows one before any tap', () => {
  const expected: Partial<Record<TripStatus, string>> = {
    [TripStatus.SCHEDULED]: 'Start boarding',
    [TripStatus.BOARDING]: 'Depart & drive',
    [TripStatus.IN_PROGRESS]: 'Complete trip',
  };
  for (const status of Object.values(TripStatus)) {
    const action = primaryTripAction(status);
    if (expected[status]) {
      assert.equal(action?.label, expected[status]);
      assert.ok(action?.icon, 'the primary action always carries an icon');
    } else {
      assert.equal(action, null, `${status} is terminal: no primary action`);
    }
  }
});
