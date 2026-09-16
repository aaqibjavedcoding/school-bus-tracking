import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { collectSourceFiles, fontSizeViolations } from './legibility.ts';

/**
 * Two layers of tests:
 *
 * 1. unit tests pin what the scanner itself understands (literal numbers and
 *    the token aliases style code uses);
 * 2. the guard tests apply it to the real source tree — crew surfaces at a
 *    14px floor, the rest of the app at the 13px shared floor — so a future
 *    screen that re-introduces small text fails here, in CI, instead of in
 *    a driver's hand.
 */

test('flags literal and token-alias sizes below the floor', () => {
  const source = [
    'const styles = StyleSheet.create({',
    '  title: { fontSize: 15 },',
    '  meta: { fontSize: typography.fontSizes.xs },',
    '  hint: { fontSize: typography.fontSizes.sm },',
    '  body: { fontSize: typography.fontSizes.base },',
    '  label: { fontSize: text.secondary },',
    '});',
  ].join('\n');

  // 15px breaches the 16px floor but not the 14px one; xs(12) breaches both,
  // and text.secondary (13) breaches the 14px floor.
  assert.deepEqual(
    fontSizeViolations(source, 14).map((violation) => violation.line),
    [3, 6],
  );
  assert.deepEqual(
    fontSizeViolations(source, 16).map((violation) => violation.line),
    [2, 3, 4, 6],
  );
});

test('ignores dynamic expressions and prose mentions of fontSize', () => {
  const source = [
    '  fontSize: compact ? 12 : 16, // not a literal, skipped',
    '// fontSize: 10 in a comment must not fail anything',
    '  fontSize: text.numeric,',
  ].join('\n');
  assert.deepEqual(fontSizeViolations(source, 16), []);
});

// The test script always runs from the mobile workspace root (`npm --prefix
// mobile test`), and scanning the tree is the point of these guards, so the
// working directory — not this file's location — is the anchor.
const mobileRoot = `${process.cwd()}/`;
const readDir = (dir: string) =>
  readdirSync(dir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));

function violationsUnder(roots: string[], floor: number): string[] {
  const failures: string[] = [];
  for (const root of roots) {
    for (const file of collectSourceFiles(`${mobileRoot}${root}`, readDir)) {
      for (const violation of fontSizeViolations(readFileSync(file, 'utf8'), floor)) {
        failures.push(`${file}:${violation.line} — ${violation.snippet}`);
      }
    }
  }
  return failures;
}

// Crew = drivers + conductors: every screen they can see, including the
// shared live-tracking views those screens render.
const CREW_ROOTS = ['app/(crew)', 'src/features/crew', 'src/features/tracking'];

test('crew surfaces contain no text below 14px', () => {
  assert.deepEqual(violationsUnder(CREW_ROOTS, 14), []);
});

test('the whole app keeps the 13px shared floor (labels/secondary minimum)', () => {
  assert.deepEqual(violationsUnder(['app', 'src'], 13), []);
});
