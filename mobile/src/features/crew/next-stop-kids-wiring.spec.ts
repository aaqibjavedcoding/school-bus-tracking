import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * Source-scanning wiring guard for the next-stop kids/voice race (P0-2), in the
 * family of `crew-feedback-wiring.spec.ts` and `i18n-literals.spec.ts`.
 *
 * The bug was architectural, not something a unit test on the pure
 * `summarizeNextStopKids` can see: on the render where `nextStopId` changes,
 * `useLoad` still holds the PREVIOUS stop's data with `loading` still false, so
 * a summary computed from that stale slice reports `total: 0` while `loaded` is
 * true — and the announcer says "no children" for a stop that has kids.
 *
 * The fix is a self-identifying manifest slice (`{ stopId, items }`) plus a
 * call-site guard that the trip screen can only pass `loaded: true` when the
 * slice's stop id matches the current next stop. A filesystem assertion is what
 * keeps that contract holding for code nobody has written yet.
 */

const mobileRoot = `${process.cwd()}/`;
const read = (path: string): string => readFileSync(`${mobileRoot}${path}`, 'utf8');

/** Source with block/line comments removed, so prose can't satisfy a rule. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const TRIP_SCREEN = 'app/(crew)/trip.tsx';

describe('next-stop kids/voice is stop-id guarded (P0-2)', () => {
  test('the manifest loader tags every slice with the stop id it fetched', () => {
    const trip = code(TRIP_SCREEN);
    assert.ok(
      /stopId:\s*nextStopId/.test(trip),
      'the kids loader must return a self-identifying { stopId, items } slice',
    );
  });

  test('`loaded` is only true when the slice belongs to the current next stop', () => {
    const trip = code(TRIP_SCREEN);
    // The match is derived from the slice's own stop id vs the current one.
    assert.ok(
      /\(kidsLoad\.data\?\.stopId\s*\?\?\s*null\)\s*===\s*nextStopId/.test(trip),
      'kidsLoaded must compare the slice stop id to nextStopId',
    );
    // …and combined with the not-loading signal.
    assert.ok(
      /const\s+kidsLoaded\s*=\s*!kidsLoad\.loading\s*&&\s*kidsMatchNextStop/.test(trip),
      'kidsLoaded must be `!kidsLoad.loading && <stop-id match>`',
    );
  });

  test('the trip screen never passes the raw not-loading flag as loaded', () => {
    const trip = code(TRIP_SCREEN);
    // The exact footgun: handing `!kidsLoad.loading` straight to a consumer
    // ignores the stop-id match and re-opens the race.
    for (const offender of [
      /loaded:\s*!kidsLoad\.loading/,
      /loaded=\{!kidsLoad\.loading\}/,
      /kidsLoaded=\{!kidsLoad\.loading\}/,
    ]) {
      assert.ok(
        !offender.test(trip),
        `the trip screen must pass the guarded \`kidsLoaded\`, not the raw not-loading flag (${offender})`,
      );
    }
  });

  test('every kids consumer receives the guarded value', () => {
    const trip = code(TRIP_SCREEN);
    // The announcer, the driver navigation card and the conductor kids card all
    // read `kidsLoaded` — the one guarded source of truth.
    assert.ok(/loaded:\s*kidsLoaded/.test(trip), 'the announcer reads kidsLoaded');
    assert.ok(/kidsLoaded=\{kidsLoaded\}/.test(trip), 'the driver card reads kidsLoaded');
    assert.ok(/loaded=\{kidsLoaded\}/.test(trip), 'the conductor card reads kidsLoaded');
  });

  test('the summary is computed from a stop-id-matched slice, never raw data', () => {
    const trip = code(TRIP_SCREEN);
    assert.ok(
      /summarizeNextStopKids\(\s*kidsMatchNextStop\s*\?/.test(trip),
      'summarizeNextStopKids must be fed the guarded slice (empty when the stop id does not match)',
    );
  });
});
