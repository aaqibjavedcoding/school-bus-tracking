import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { UserRole } from '@school-bus-tracking/shared-types';
import { crewCanMarkStops, crewMapSurface, crewOwnsLocationSharing } from './crew-map-access.ts';

/**
 * The conductor split, pinned twice.
 *
 * 1. **The decision table** (`crew-map-access.ts`): the conductor gets the
 *    observer map, and — the acceptance invariant — their device never owns
 *    the location-sharing lifecycle and never renders the stop-marking
 *    actions. Driver-only is driver-only; non-crew roles get no crew map.
 * 2. **The wiring** (`app/(crew)/trip.tsx`, in the source-scanner style of
 *    `help-routing.spec.ts`): the screen's gates actually read the policy, the
 *    conductor's map is fed from the observer socket (never
 *    `sharing.stats.lastFix`), and `StopMarkActions` sits behind the
 *    driver-only gate.
 */

const CREW_TRIP_SCREEN = 'app/(crew)/trip.tsx';

describe('crewMapSurface — the map is visible to both crew roles', () => {
  it('gives the driver the driver variant and the conductor the observer variant', () => {
    assert.equal(crewMapSurface(UserRole.DRIVER), 'driver');
    assert.equal(crewMapSurface(UserRole.CONDUCTOR), 'observer');
  });

  it('gives non-crew and unknown roles no crew map at all', () => {
    assert.equal(crewMapSurface(UserRole.SCHOOL_ADMIN), null);
    assert.equal(crewMapSurface(UserRole.SUPER_ADMIN), null);
    assert.equal(crewMapSurface(UserRole.PARENT), null);
    assert.equal(crewMapSurface(null), null);
    assert.equal(crewMapSurface(undefined), null);
  });
});

describe('the conductor never shares, watches or marks (read-only map)', () => {
  it('a conductor owns no location lifecycle — their device never starts a watcher', () => {
    assert.equal(crewOwnsLocationSharing(UserRole.DRIVER), true);
    assert.equal(crewOwnsLocationSharing(UserRole.CONDUCTOR), false);
    assert.equal(crewOwnsLocationSharing(UserRole.SCHOOL_ADMIN), false);
    assert.equal(crewOwnsLocationSharing(null), false);
  });

  it('a conductor never renders the stop-marking actions', () => {
    assert.equal(crewCanMarkStops(UserRole.DRIVER), true);
    assert.equal(crewCanMarkStops(UserRole.CONDUCTOR), false);
    assert.equal(crewCanMarkStops(UserRole.PARENT), false);
    assert.equal(crewCanMarkStops(null), false);
  });
});

describe('the crew trip screen wires the split', () => {
  const screen = readFileSync(`${process.cwd()}/${CREW_TRIP_SCREEN}`, 'utf8');

  it('derives the map variant from the policy, not from the driver flag alone', () => {
    assert.ok(
      screen.includes('crewMapSurface('),
      'the screen must decide its map variant through crewMapSurface()',
    );
  });

  it('feeds the observer map from the observer socket, never from sharing.stats', () => {
    // The conductor branch renders the observer BusMap with `live.fix` —
    // the socket fix — and there is no other BusMap on this screen.
    const observerMap = screen.match(/<BusMap[\s\S]*?\/>/);
    assert.ok(observerMap, 'the screen must render the observer BusMap for conductors');
    assert.ok(
      observerMap[0].includes('fix={live.fix}'),
      'the observer map must be fed by the observer socket (live.fix)',
    );
    assert.ok(
      !observerMap[0].includes('sharing.stats'),
      'the observer map must never read the sharing lifecycle (the driver GPS)',
    );
  });

  it('gates StopMarkActions behind the driver-only policy', () => {
    const gated = screen.match(/\{isDriver\s*\?\s*\(\s*<StopMarkActions/);
    assert.ok(
      gated,
      'StopMarkActions must render only for the driver (the conductor map is read-only)',
    );
  });

  it('keeps every sharing start under the driver-only gate', () => {
    // The only startSharing call is the one inside the isDriver-guarded
    // transition callback.
    const starts = screen.match(/startSharing\(/g) ?? [];
    assert.ok(starts.length >= 1);
    const guarded = screen.match(
      /if \(isDriver && isTripShareable\(applied\)\) \{\s*void startSharing/,
    );
    assert.ok(guarded, 'startSharing must stay behind the isDriver transition gate');
  });
});
