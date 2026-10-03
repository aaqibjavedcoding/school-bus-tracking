import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOsrmRouteResponse } from './osrm-response';

/**
 * The parser is the trust boundary between the routing engine and the
 * forever-cache: whatever passes here is stored for eternity and served to
 * drivers. These cases pin the strict/lenient split documented in the
 * module — strict route level (nothing partial is ever cached), lenient
 * step level (a bad maneuver never sinks a good polyline) — and the prime
 * directive: never throw, always return null on junk.
 */

/** The smallest fully-valid OSRM `Ok` response the tests extend. */
function validResponse(): Record<string, unknown> {
  return {
    code: 'Ok',
    routes: [
      {
        geometry: {
          type: 'LineString',
          coordinates: [
            [73.0479, 33.6844],
            [73.0551, 33.6901],
            [73.0613, 33.6972],
          ],
        },
        distance: 4820.5,
        duration: 612.3,
        legs: [
          {
            distance: 2410.2,
            duration: 300.1,
            steps: [
              {
                distance: 120.4,
                duration: 18.2,
                name: 'Margalla Road',
                maneuver: { type: 'depart', location: [73.0479, 33.6844] },
              },
              {
                distance: 2289.8,
                duration: 281.9,
                name: '7th Avenue',
                maneuver: { type: 'turn', modifier: 'left', location: [73.0551, 33.6901] },
              },
            ],
          },
          {
            distance: 2410.3,
            duration: 312.2,
            steps: [
              {
                distance: 2410.3,
                duration: 312.2,
                name: 'Kashmir Highway',
                maneuver: { type: 'arrive', location: [73.0613, 33.6972] },
              },
            ],
          },
        ],
      },
    ],
    waypoints: [
      { hint: 'x', distance: 1.2, name: '', location: [73.0479, 33.6844] },
      { hint: 'y', distance: 0.4, name: '', location: [73.0613, 33.6972] },
    ],
  };
}

describe('parseOsrmRouteResponse', () => {
  it('maps a valid OSRM response onto our road-route shape', () => {
    const route = parseOsrmRouteResponse(validResponse());
    assert.ok(route, 'expected a parsed route');

    assert.deepEqual(route.geometry, {
      type: 'LineString',
      coordinates: [
        [73.0479, 33.6844],
        [73.0551, 33.6901],
        [73.0613, 33.6972],
      ],
    });
    assert.equal(route.distanceMeters, 4820.5);
    assert.equal(route.durationSeconds, 612.3);
    assert.equal(route.legs.length, 2);

    const [firstLeg] = route.legs;
    assert.equal(firstLeg.distanceMeters, 2410.2);
    assert.equal(firstLeg.durationSeconds, 300.1);
    assert.equal(firstLeg.maneuvers.length, 2);

    const [depart, turn] = firstLeg.maneuvers;
    // `depart` carries no modifier in OSRM — it must surface as null.
    assert.deepEqual(depart, {
      type: 'depart',
      modifier: null,
      roadName: 'Margalla Road',
      distanceMeters: 120.4,
      location: [73.0479, 33.6844],
    });
    assert.deepEqual(turn, {
      type: 'turn',
      modifier: 'left',
      roadName: '7th Avenue',
      distanceMeters: 2289.8,
      location: [73.0551, 33.6901],
    });
  });

  it('returns our vocabulary, not OSRM field names', () => {
    const route = parseOsrmRouteResponse(validResponse());
    assert.ok(route);
    const serialized = JSON.stringify(route);
    for (const osrmKey of ['"duration"', '"distance"', '"steps"', '"maneuver"', '"name"']) {
      assert.equal(serialized.includes(osrmKey), false, `${osrmKey} must not leak through`);
    }
  });

  it('returns null for any engine outcome other than Ok', () => {
    for (const code of ['NoRoute', 'NoTrips', 'InvalidQuery', 'NotEnoughSegments', 200, null]) {
      const body = { ...validResponse(), code };
      assert.equal(parseOsrmRouteResponse(body), null, `code=${String(code)}`);
    }
  });

  it('returns null when there is no route to give', () => {
    assert.equal(parseOsrmRouteResponse({ code: 'Ok', routes: [] }), null);
    assert.equal(parseOsrmRouteResponse({ code: 'Ok' }), null);
    assert.equal(parseOsrmRouteResponse({ code: 'Ok', routes: 'nope' }), null);
    assert.equal(parseOsrmRouteResponse({ code: 'Ok', routes: [null] }), null);
    assert.equal(parseOsrmRouteResponse({ code: 'Ok', routes: [42] }), null);
  });

  it('returns null for unusable geometry, so a partial line is never cached', () => {
    const withGeometry = (geometry: unknown) => ({
      code: 'Ok',
      routes: [{ geometry, distance: 1, duration: 1 }],
    });
    assert.equal(parseOsrmRouteResponse(withGeometry(null)), null);
    assert.equal(parseOsrmRouteResponse(withGeometry({})), null);
    assert.equal(
      parseOsrmRouteResponse(withGeometry({ type: 'Point', coordinates: [73, 33] })),
      null,
    );
    assert.equal(
      // A single position is not a followable line.
      parseOsrmRouteResponse(withGeometry({ type: 'LineString', coordinates: [[73, 33]] })),
      null,
    );
    assert.equal(
      parseOsrmRouteResponse(
        withGeometry({
          type: 'LineString',
          coordinates: [
            [73, 33],
            ['73.05', 33.69],
          ],
        }),
      ),
      null,
    );
    assert.equal(
      // Out of WGS-84 range — poisoned geometry must not reach the cache.
      parseOsrmRouteResponse(
        withGeometry({
          type: 'LineString',
          coordinates: [
            [73, 33],
            [730, 33],
          ],
        }),
      ),
      null,
    );
  });

  it('returns null when the route totals are not finite numbers', () => {
    for (const [distance, duration] of [
      [null, 1],
      [1, undefined],
      ['4820', 1],
      [1, Number.NaN],
      [Number.POSITIVE_INFINITY, 1],
    ]) {
      const body = {
        code: 'Ok',
        routes: [{ geometry: validGeometry(), distance, duration }],
      };
      assert.equal(parseOsrmRouteResponse(body), null, `distance=${distance} duration=${duration}`);
    }
  });

  it('drops extra ordinates (altitude) from positions', () => {
    const body = {
      code: 'Ok',
      routes: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [73.0479, 33.6844, 540],
              [73.0551, 33.6901, 512],
            ],
          },
          distance: 10,
          duration: 5,
        },
      ],
    };
    const route = parseOsrmRouteResponse(body);
    assert.ok(route);
    assert.deepEqual(route.geometry.coordinates, [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
    ]);
  });

  it('tolerates missing legs and missing steps — the polyline alone is servable', () => {
    const noLegs = {
      code: 'Ok',
      routes: [{ geometry: validGeometry(), distance: 10, duration: 5 }],
    };
    const route = parseOsrmRouteResponse(noLegs);
    assert.ok(route);
    assert.deepEqual(route.legs, []);

    const stepsMissing = {
      code: 'Ok',
      routes: [
        {
          geometry: validGeometry(),
          distance: 10,
          duration: 5,
          legs: [{ distance: 10, duration: 5 }],
        },
      ],
    };
    const route2 = parseOsrmRouteResponse(stepsMissing);
    assert.ok(route2);
    assert.deepEqual(route2.legs, [{ distanceMeters: 10, durationSeconds: 5, maneuvers: [] }]);
  });

  it('skips a malformed leg or step instead of sinking the route', () => {
    const body = validResponse();
    const routes = body['routes'] as Array<Record<string, unknown>>;
    const legs = routes[0]['legs'] as unknown[];
    legs.push({ distance: 'bogus', duration: 1 });
    const firstLeg = legs[0] as Record<string, unknown>;
    (firstLeg['steps'] as unknown[]).push(
      { distance: 1, name: 'x', maneuver: { location: [73, 33] } }, // no maneuver type
      'garbage',
      null,
    );

    const route = parseOsrmRouteResponse(body);
    assert.ok(route);
    assert.equal(route.legs.length, 2, 'the malformed third leg must be dropped');
    assert.equal(route.legs[0].maneuvers.length, 2, 'the malformed steps must be dropped');
  });

  it('never throws on outright junk', () => {
    for (const junk of [null, undefined, 42, 'Ok', [], [null], true, Symbol.iterator]) {
      assert.equal(parseOsrmRouteResponse(junk), null);
    }
  });
});

function validGeometry(): Record<string, unknown> {
  return {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
    ],
  };
}
