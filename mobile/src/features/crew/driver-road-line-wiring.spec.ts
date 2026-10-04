import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * Source-scanning guard for the road line ahead (Session 3), in the family of
 * `bus-marker-invariants.spec.ts` and `crew-feedback-wiring.spec.ts`.
 *
 * A React Native view tree cannot be rendered under `node --test`, and the
 * road line's risk is exactly the kind a renderer would not catch anyway:
 * a *caption* lying about a *line*. The builder's geometry decisions are
 * pinned in `trip-map-geometry.spec.ts` and the cache's in
 * `route-geometry-core.spec.ts`; what only this file can pin is that the
 * pieces are wired together honestly:
 *
 * - the driver map draws ONE amber ahead-line — the road when the geometry
 *   serves the trip, the planned legs otherwise — through the same prop and
 *   therefore the same paint, never two layers;
 * - the legend caption follows the shape actually drawn (`map.roadNotice`
 *   only over a road line, `map.plannedNotice` only over the fallback);
 * - the geometry is loaded once per trip through the offline cache, and a
 *   payload fetched for another route never survives a route switch;
 * - the trail, the one-layer stops and the shared camera are untouched.
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

/** Source with comments removed, so docs cannot satisfy a code guard. */
function code(path: string): string {
  return read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

describe('the road line ahead — wiring', () => {
  const driver = code('src/features/crew/DriverTripMap.tsx');
  const webDriver = code('src/features/crew/DriverTripMap.web.tsx');
  const observer = code('src/features/map/BusMap.tsx');
  const surface = code('src/features/map/LiveMapSurface.tsx');
  const webSurface = code('src/features/map/LiveWebViewMap.web.tsx');

  test('the driver map loads the geometry once per trip through the offline cache', () => {
    assert.match(driver, /loadTripRoadGeometry\(tripId, routeId\)/);
    // The loaded payload names the route it was fetched for, and a payload
    // from another route is refused — the same discipline the trail applies
    // to another trip's fixes (historyFixesForTrip).
    assert.match(driver, /roadGeometryLoad\.data\.routeId === routeId/);
  });

  test('the road line replaces the planned legs when it exists — same paint, one layer', () => {
    assert.match(driver, /buildRoadRouteLine\(roadGeometry, \{ fromStopId: nextStopId, stops \}\)/);
    assert.match(driver, /roadFeature \?\? plannedFeature/);
    // One ahead-line slot on the surface: the road travels in the planned
    // line's own prop, so it inherits the amber colour and width instead of
    // adding a second source/layer pair.
    assert.match(driver, /plannedFeature=\{aheadFeature\}/);
    assert.doesNotMatch(
      driver,
      /roadFeature=\{|trailFeature=\{roadFeature/,
      'the road line must not add a second map layer',
    );
    // The fallback stays wired: nothing ahead has changed for the cases the
    // road builder refuses (pinned in trip-map-geometry.spec.ts).
    assert.match(driver, /buildPlannedLegsLine\(stops, nextStopId\)/);
  });

  test('the caption follows the drawn shape on both surfaces', () => {
    for (const [name, source] of [
      ['LiveMapSurface', surface],
      ['LiveWebViewMap.web', webSurface],
    ] as const) {
      assert.match(
        source,
        /plannedLineKind === 'road'/,
        `${name}: the road caption is keyed on the drawn shape`,
      );
      assert.match(source, /t\('map\.roadNotice'\)/, `${name}: road caption key`);
      assert.match(source, /t\('map\.plannedNotice'\)/, `${name}: fallback caption key`);
      // Callers that have not adopted the road line keep today's caption.
      assert.match(source, /plannedLineKind = 'planned'/, `${name}: 'planned' is the default`);
    }
    assert.match(
      driver,
      /plannedLineKind=\{roadFeature \? 'road' : 'planned'\}/,
      'the driver map states which shape it drew',
    );
  });

  test('the web driver fallback still draws the honest planned line (session scope)', () => {
    // The web build of the driver map deliberately keeps the planned legs:
    // its caption (plannedLineKind defaults to 'planned') stays true to the
    // line it draws, and no surface may show the road caption without a road
    // line underneath it.
    assert.match(webDriver, /buildPlannedLegsLine\(stops, nextStopId\)/);
    assert.doesNotMatch(
      webDriver,
      /buildRoadRouteLine|loadTripRoadGeometry|map\.roadNotice/,
      'the web fallback must not claim the road route',
    );
    for (const [name, source] of [
      ['BusMap', observer],
      ['DriverTripMap.web', webDriver],
    ] as const) {
      assert.doesNotMatch(
        source,
        /map\.roadNotice/,
        `${name}: the road caption belongs to the road line only`,
      );
    }
  });

  test('the trail, the one-layer stops and the shared camera are untouched', () => {
    // The trail still comes from the server's recorded fixes for THIS trip,
    // decimated before it reaches the map source — the road line changes
    // nothing about it.
    assert.match(driver, /buildTrailLine\(historyFixesForTrip\(/);
    assert.match(driver, /decimateTrailLine\(line\)/);
    assert.match(driver, /trailFeature=\{trailFeature\}/);
    // The camera and the stops stay the surface's (pinned further by
    // bus-marker-invariants.spec.ts, which must stay green unmodified).
    assert.match(driver, /<LiveMapSurface/);
    assert.doesNotMatch(driver, /useFollowCamera\(/);
  });
});
