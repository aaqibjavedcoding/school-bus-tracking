import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TripAttendanceStatus } from '@school-bus-tracking/shared-types';

import {
  MANIFEST_ROW_MIN_HEIGHT,
  ROW_ACTION_GLYPH_SIZE,
  ROW_FLASH_GREEN,
  ROW_NAME_SIZE,
  confirmationLine,
  rowActionFor,
  rowA11yLabel,
  rowActionGlyph,
  settledSymbol,
  successAnnouncement,
} from './manifest-row.ts';
import { contrastRatio } from '../../theme/contrast.ts';

const row = (overrides: Partial<Parameters<typeof confirmationLine>[0]> = {}) => ({
  first_name: 'Ramesh',
  last_name: 'Kumar',
  status: TripAttendanceStatus.PENDING,
  boarded_at: null,
  dropped_at: null,
  ...overrides,
});

test('touch floors: row ≥60px, glyph zone ≥60px, name 18px bold', () => {
  assert.ok(MANIFEST_ROW_MIN_HEIGHT >= 60);
  assert.ok(ROW_ACTION_GLYPH_SIZE >= 60);
  assert.equal(ROW_NAME_SIZE, 18);
});

test('the whole row acts: one contextual action per attendance state', () => {
  assert.equal(rowActionFor(TripAttendanceStatus.PENDING, true), 'board');
  assert.equal(rowActionFor(TripAttendanceStatus.BOARDED, true), 'drop');
  assert.equal(rowActionFor(TripAttendanceStatus.DROPPED, true), null);
  // A closed trip cannot act at all — no hidden taps.
  assert.equal(rowActionFor(TripAttendanceStatus.PENDING, false), null);
  assert.equal(rowActionFor(TripAttendanceStatus.BOARDED, false), null);
});

test('the right-hand glyph is ✓ for board (green) and ✕ for drop (neutral)', () => {
  assert.deepEqual(rowActionGlyph('board'), { icon: 'checkmark-circle', tone: 'success' });
  assert.deepEqual(rowActionGlyph('drop'), { icon: 'close-circle', tone: 'neutral' });
  assert.equal(rowActionGlyph(null), null);
});

test('inline confirmation reads “Name ✓ time” from the server timestamps', () => {
  assert.equal(
    confirmationLine(row({ status: TripAttendanceStatus.BOARDED, boarded_at: '2026-02-02T07:42:00.000Z' }), 'recorded'),
    'Ramesh Kumar ✓ 7:42 AM',
  );
  assert.equal(
    confirmationLine(row({ status: TripAttendanceStatus.DROPPED, dropped_at: '2026-02-02T01:05:00.000Z' }), 'recorded'),
    'Ramesh Kumar ✕ 1:05 AM',
  );
  // No timestamp → no invented confirmation.
  assert.equal(confirmationLine(row({ status: TripAttendanceStatus.BOARDED, boarded_at: null }), 'recorded'), null);
  // Offline success shows the queued note instead of a fake clock.
  assert.match(
    confirmationLine(row({ status: TripAttendanceStatus.BOARDED }), 'queued')!,
    /Ramesh Kumar ⏳ saved offline/,
  );
});

test('settled rows still show a symbol when the trip is closed', () => {
  assert.equal(settledSymbol(TripAttendanceStatus.BOARDED), '✓');
  assert.equal(settledSymbol(TripAttendanceStatus.DROPPED), '✕');
  assert.equal(settledSymbol(TripAttendanceStatus.PENDING), '…');
});

test('accessibility: every row state has a spoken label and a success announcement', () => {
  assert.match(rowA11yLabel(row(), 'board'), /Ramesh Kumar, waiting\. Double-tap to board\./);
  assert.match(
    rowA11yLabel(row({ status: TripAttendanceStatus.BOARDED }), 'drop'),
    /Ramesh Kumar, on board/,
  );
  assert.match(
    rowA11yLabel(row({ status: TripAttendanceStatus.DROPPED }), null),
    /Ramesh Kumar, dropped off/,
  );
  assert.equal(successAnnouncement('Ramesh Kumar', 'board'), 'Ramesh Kumar boarded');
  assert.equal(successAnnouncement('Ramesh Kumar', 'drop'), 'Ramesh Kumar dropped');
});

test('the success flash colour keeps the measured badge-success contrast with its text colour', () => {
  // The flash reuses the badge-success surface (#dcfce7) whose 6.49:1 dark-green
  // text pair is pinned in `theme/contrast.spec.ts`; assert the same surface here.
  assert.equal(ROW_FLASH_GREEN, '#dcfce7');
  assert.ok(contrastRatio('#166534', ROW_FLASH_GREEN) >= 4.5);
});
