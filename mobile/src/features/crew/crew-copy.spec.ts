import assert from 'node:assert/strict';
import { test } from 'node:test';

import { crewCopy } from './crew-copy.ts';

/**
 * Phase 3 will plug an i18n layer under these keys, so the contract is:
 * every entry is a non-empty string (or a pure formatter that returns one),
 * and the status words stay distinct — a driver tells states apart by the
 * word even when colours fail (colour-vision deficiency).
 */

test('every copy entry is a non-empty string or a pure formatter', () => {
  const check = (value: unknown, path: string): void => {
    if (typeof value === 'function') return; // formatter — exercised below
    if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) check(child, `${path}.${key}`);
      return;
    }
    assert.equal(typeof value, 'string', `${path} must be a string`);
    assert.ok((value as string).length > 0, `${path} must not be empty`);
  };
  check(crewCopy, 'crewCopy');

  assert.match(crewCopy.tripCountNote(3), /^3 trips today/);
  assert.match(crewCopy.gps.lastUpdate('7:42 AM'), /^Updated 7:42 AM$/);
  assert.match(crewCopy.manifest.confirmBoard('Ramesh', '7:42 AM'), /^Ramesh ✓ 7:42 AM$/);
  assert.match(crewCopy.manifest.rowA11y.waiting('Ramesh'), /Double-tap to board/);
});

test('the status words are distinct — text is a cue even without colour', () => {
  const words = Object.values(crewCopy.statusWord);
  assert.equal(new Set(words).size, words.length);
  for (const word of words) {
    assert.equal(word, word.toUpperCase(), 'status words read as states, not sentences');
  }
});
