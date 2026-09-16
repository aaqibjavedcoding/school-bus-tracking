import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AA_TEXT,
  CONTRAST_PAIRS,
  OLD_PRIMARY_BUTTON_RATIO,
  contrastRatio,
  relativeLuminance,
} from './contrast.ts';

test('relativeLuminance matches the WCAG reference values', () => {
  // Black → 0, white → 1 are the two anchors of the scale.
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  // WCAG worked example: #777777 has a 4.48:1 ratio with white and a 4.68:1
  // ratio with black — one anchor is enough to pin the curve.
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
});

test('contrastRatio is symmetric and clamps at 21:1 for black on white', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
});

test('contrastRatio rejects malformed colours instead of guessing', () => {
  assert.throws(() => relativeLuminance('amber'));
  assert.throws(() => relativeLuminance('#abc'));
});

test('the old white-on-primary[500] button really did fail (documents the bug)', () => {
  // This is why the action surface moved to primary[700] — keep this test as
  // the regression marker so nobody reverts the palette by accident.
  const ratio = OLD_PRIMARY_BUTTON_RATIO();
  assert.ok(ratio < AA_TEXT, `expected the old pair to fail AA, got ${ratio}`);
  assert.ok(Math.abs(ratio - 2.15) < 0.05);
});

test('every text/background pair the UI ships meets its WCAG floor', () => {
  const failures: string[] = [];
  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(pair.foreground, pair.background);
    if (ratio < pair.minimum) {
      failures.push(
        `${pair.name}: ${ratio.toFixed(2)}:1 < ${pair.minimum}:1 ` +
          `(${pair.foreground} on ${pair.background})`,
      );
    }
  }
  assert.deepEqual(failures, []);
});

test('the primary action pair keeps its published 5.01:1 ratio', () => {
  const pair = CONTRAST_PAIRS.find((entry) => entry.name === 'primary action label');
  assert.ok(pair);
  assert.ok(
    Math.abs(contrastRatio(pair.foreground, pair.background) - 5.01) < 0.05,
    'white on secondary[700] must stay at the verified 5.01:1',
  );
});
