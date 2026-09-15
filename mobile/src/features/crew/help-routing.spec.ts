import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase-2 information-architecture guard, in the same spirit as
 * `theme/legibility.spec.ts`: a source scanner that pins *where* things live,
 * so a future edit cannot silently undo the move.
 *
 * The driver must never again see GPS telemetry while driving — the counters
 * live on the Help/Support screen. This spec asserts the move in both
 * directions (gone from the trip screen, present on Help) plus the hold-to-
 * confirm wiring of SOS, so "removed" and "moved" can never be confused.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

const TRIP_SCREEN = 'app/(crew)/trip.tsx';
const HELP_SCREEN = 'app/(crew)/help.tsx';
const GPS_PANEL = 'src/features/crew/GpsSharePanel.tsx';
const LAYOUT = 'app/(crew)/_layout.tsx';

test('GpsSharePanel is no longer rendered on the trip screen', () => {
  const trip = read(TRIP_SCREEN);
  assert.ok(
    !trip.includes('GpsSharePanel'),
    'trip.tsx must not import or render GpsSharePanel — telemetry moved to the Help screen',
  );
});

test('GpsSharePanel is rendered on the Help/Support screen (moved, not deleted)', () => {
  const help = read(HELP_SCREEN);
  assert.ok(help.includes('GpsSharePanel'), 'help.tsx must render the full GpsSharePanel');
  const panel = read(GPS_PANEL);
  for (const counter of ['Sent', 'Rejected', 'Dropped (offline)', 'Invalid fix']) {
    assert.ok(
      panel.includes(`"${counter}"`),
      `the support counter “${counter}” must stay on the Help surface`,
    );
  }
});

test('the Help screen exists in the crew navigator (hidden tab, reachable)', () => {
  const layout = read(LAYOUT);
  assert.ok(layout.includes('name="help"'), 'the crew tab layout must register the help screen');
  assert.ok(layout.includes('href: null'), 'the help screen must be hidden from the tab bar');
});

test('SOS fires through the hold-to-confirm controller — never a bare press', () => {
  const sosPanel = read('src/features/crew/SosPanel.tsx');
  assert.ok(
    sosPanel.includes('HoldToConfirmButton') || sosPanel.includes('HoldToConfirm'),
    'SosPanel must raise alerts via the hold-to-confirm pattern',
  );
  assert.ok(
    sosPanel.includes('SosSession'),
    'SosPanel must run its idempotency-key lifecycle through SosSession',
  );
  const holdButton = read('src/features/crew/HoldToConfirmButton.tsx');
  assert.ok(
    holdButton.includes('HoldToConfirm'),
    'the SOS button component must be driven by the pure HoldToConfirm controller',
  );
});

test('the trip screen keeps its single-purpose shape: status card, one primary action, SOS row', () => {
  const trip = read(TRIP_SCREEN);
  assert.ok(trip.includes('StatusCard'), 'the trip screen leads with the giant status card');
  assert.ok(trip.includes('TripStatusActions'), 'the primary action comes from TripStatusActions');
  assert.ok(trip.includes('GpsShareStrip'), 'the driver GPS row is the compact strip');
  assert.ok(trip.includes('/help'), 'the Help screen must be reachable from the trip screen');
});
