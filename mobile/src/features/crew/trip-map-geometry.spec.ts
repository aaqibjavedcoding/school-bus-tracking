import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { StopResponse, TripLocationResponse } from '@school-bus-tracking/shared-types';

import {
  buildArrivalZonePolygon,
  buildPlannedLegsLine,
  buildRoadRouteLine,
  buildTrailLine,
  historyFixesForTrip,
  upcomingStopsFrom,
} from './trip-map-geometry.ts';
import { OFFLINE_FALLBACK_MIN_RADIUS_METERS } from './arrival-zone.ts';

/**
 * The driver map's honest lines, pinned.
 *
 * - the trail may only ever be built from recorded fixes;
 * - the planned line may only ever start at the **next stop the screen was
 *   given** — the map never picks one — and may only reach stops with real
 *   coordinates;
 * - the road line may only ever be the engine's polyline trimmed from that
 *   same next stop, and every one of its nulls leaves the planned line as
 *   the fallback;
 * - all of them prefer "draw nothing" (`null`) over drawing a wrong or
 *   implied line.
 */

function fix(
  latitude: number,
  longitude: number,
): Pick<TripLocationResponse, 'latitude' | 'longitude'> {
  return { latitude, longitude };
}

function stop(
  id: string,
  sequenceNumber: number,
  latitude: number | null,
  longitude: number | null,
  name = `Stop ${sequenceNumber}`,
): StopResponse {
  return {
    id,
    school_id: 'school-1',
    route_id: 'route-1',
    name,
    sequence_number: sequenceNumber,
    latitude,
    longitude,
    address: null,
    geofence_radius_meters: 100,
    effective_radius_meters: 100,
    estimated_arrival_time: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('buildTrailLine — the driven path', () => {
  it('builds one LineString from chronological fixes', () => {
    const line = buildTrailLine([fix(19.076, 72.8777), fix(19.079, 72.88), fix(19.082, 72.883)]);
    assert.ok(line);
    assert.equal(line.geometry.type, 'LineString');
    assert.deepEqual(line.geometry.coordinates, [
      [72.8777, 19.076],
      [72.88, 19.079],
      [72.883, 19.082],
    ]);
  });

  it('returns null for empty or single-fix data (no path exists yet)', () => {
    assert.equal(buildTrailLine([]), null);
    assert.equal(buildTrailLine([fix(19.076, 72.8777)]), null);
  });

  it('drops invalid coordinates instead of drawing them', () => {
    const line = buildTrailLine([
      fix(19.076, 72.8777),
      fix(Number.NaN, 72.88),
      fix(91, 72.885),
      fix(19.082, 72.883),
    ]);
    assert.ok(line);
    assert.deepEqual(line.geometry.coordinates, [
      [72.8777, 19.076],
      [72.883, 19.082],
    ]);
  });

  it('collapses to null when only one valid fix survives filtering', () => {
    assert.equal(buildTrailLine([fix(Number.NaN, 1), fix(19.076, 72.8777)]), null);
  });
});

describe('buildPlannedLegsLine — the planned stop order ahead', () => {
  const stops = [
    stop('s1', 1, 19.05, 72.85),
    stop('s2', 2, 19.06, 72.86),
    stop('s3', 3, 19.07, 72.87),
    stop('s4', 4, 19.08, 72.88),
  ];

  it('runs from the next stop to the last stop, in sequence order', () => {
    const line = buildPlannedLegsLine(stops, 's2');
    assert.ok(line);
    assert.deepEqual(line.geometry.coordinates, [
      [72.86, 19.06],
      [72.87, 19.07],
      [72.88, 19.08],
    ]);
  });

  it('never includes stops the bus has already passed', () => {
    const line = buildPlannedLegsLine(stops, 's3');
    assert.ok(line);
    assert.equal(line.geometry.coordinates.length, 2);
    assert.deepEqual(line.geometry.coordinates[0], [72.87, 19.07]);
  });

  it('draws nothing without a next stop (trip done or not derivable)', () => {
    assert.equal(buildPlannedLegsLine(stops, null), null);
    assert.equal(buildPlannedLegsLine(stops, undefined), null);
  });

  it('draws nothing for an id that is not one of this route\'s stops', () => {
    assert.equal(buildPlannedLegsLine(stops, 'other-route-stop'), null);
  });

  it('draws nothing for a single-stop remainder — one point is not a line', () => {
    assert.equal(buildPlannedLegsLine(stops, 's4'), null);
  });

  it('skips unmapped stops but keeps drawing through mapped ones', () => {
    const gapped = [
      stop('a', 1, 19.05, 72.85),
      stop('b', 2, null, null),
      stop('c', 3, 19.07, 72.87),
      stop('d', 4, 19.08, 72.88),
    ];
    const line = buildPlannedLegsLine(gapped, 'a');
    assert.ok(line);
    assert.deepEqual(line.geometry.coordinates, [
      [72.85, 19.05],
      [72.87, 19.07],
      [72.88, 19.08],
    ]);
  });

  it('collapses to null when an invalid coordinate removes the last leg', () => {
    const bad = [
      stop('a', 1, 19.05, 72.85),
      stop('b', 2, 200, 72.86),
    ];
    assert.equal(buildPlannedLegsLine(bad, 'a'), null);
  });

  it('handles an empty stop list', () => {
    assert.equal(buildPlannedLegsLine([], 's1'), null);
  });
});

describe('buildRoadRouteLine — the road route ahead', () => {
  const stops = [
    stop('s1', 1, 19.05, 72.85),
    stop('s2', 2, 19.06, 72.86),
    stop('s3', 3, 19.07, 72.87),
    stop('s4', 4, 19.08, 72.88),
  ];

  // A road polyline that passes through every stop, with intermediate
  // vertices a routing engine would produce between them.
  const road = {
    type: 'LineString' as const,
    coordinates: [
      [72.85, 19.05],
      [72.855, 19.055],
      [72.86, 19.06],
      [72.862, 19.063],
      [72.87, 19.07],
      [72.875, 19.075],
      [72.88, 19.08],
    ] as Array<[number, number]>,
  };

  it('returns the road line from the next stop to the end of the route', () => {
    const line = buildRoadRouteLine(road, { fromStopId: 's2', stops });
    assert.ok(line);
    assert.equal(line.geometry.type, 'LineString');
    // Everything behind the next stop (s2 is a vertex of the polyline) is
    // dropped: the road already driven must not be drawn as "ahead".
    assert.deepEqual(line.geometry.coordinates, road.coordinates.slice(2));
  });

  it('starts mid-segment at the point nearest the stop, not at the segment start', () => {
    // A stop halfway along the second road segment: the trim point is its
    // projection onto that segment, the half behind the stop is dropped with
    // everything before it, and the engine's own vertices carry the rest.
    const mid = [stop('mid', 2, 19.0575, 72.8575), ...stops.slice(1)];
    const line = buildRoadRouteLine(road, { fromStopId: 'mid', stops: mid });
    assert.ok(line);
    const coordinates = line.geometry.coordinates;
    assert.equal(coordinates.length, road.coordinates.length - 1);
    const [startLng, startLat] = coordinates[0];
    assert.ok(Math.abs(startLng - 72.8575) < 1e-6, `starts near the stop: ${startLng}`);
    assert.ok(Math.abs(startLat - 19.0575) < 1e-6, `starts near the stop: ${startLat}`);
    assert.deepEqual(coordinates.slice(1), road.coordinates.slice(2));
  });

  it('draws the whole road when the next stop is the first stop', () => {
    const line = buildRoadRouteLine(road, { fromStopId: 's1', stops });
    assert.ok(line);
    assert.deepEqual(line.geometry.coordinates, road.coordinates);
  });

  it('draws nothing when the next stop is the last stop — matching the planned line', () => {
    // Nothing is ahead on either line; the two builders must agree.
    assert.equal(buildRoadRouteLine(road, { fromStopId: 's4', stops }), null);
    assert.equal(buildPlannedLegsLine(stops, 's4'), null);
  });

  it('drops invalid coordinates instead of drawing them', () => {
    const mangled = {
      type: 'LineString' as const,
      coordinates: [
        [Number.NaN, 19.05],
        ...road.coordinates,
        [200, 19.09],
      ] as Array<[number, number]>,
    };
    const line = buildRoadRouteLine(mangled, { fromStopId: 's2', stops });
    assert.ok(line);
    // The NaN pair ahead of the bus and the out-of-range pair behind it are
    // both gone, and every surviving coordinate is one of the valid ones.
    assert.deepEqual(line.geometry.coordinates, road.coordinates.slice(2));
    for (const [longitude, latitude] of line.geometry.coordinates) {
      assert.ok(
        Number.isFinite(longitude) && longitude >= -180 && longitude <= 180,
        `valid longitude: ${longitude}`,
      );
      assert.ok(
        Number.isFinite(latitude) && latitude >= -90 && latitude <= 90,
        `valid latitude: ${latitude}`,
      );
    }
  });

  it('draws nothing for a payload that is not a usable LineString', () => {
    assert.equal(buildRoadRouteLine(null, { fromStopId: 's2', stops }), null);
    assert.equal(buildRoadRouteLine(undefined, { fromStopId: 's2', stops }), null);
    assert.equal(
      buildRoadRouteLine(
        { type: 'LineString', coordinates: [] },
        { fromStopId: 's2', stops },
      ),
      null,
    );
    assert.equal(
      buildRoadRouteLine(
        { type: 'LineString', coordinates: [[72.86, 19.06]] },
        { fromStopId: 's2', stops },
      ),
      null,
    );
    assert.equal(
      buildRoadRouteLine(
        { type: 'MultiLineString', coordinates: [road.coordinates] } as unknown as never,
        { fromStopId: 's2', stops },
      ),
      null,
    );
  });

  it('draws nothing without a next stop, an unknown id, or an unsurveyed stop', () => {
    assert.equal(buildRoadRouteLine(road, { fromStopId: null, stops }), null);
    assert.equal(buildRoadRouteLine(road, { fromStopId: undefined, stops }), null);
    assert.equal(buildRoadRouteLine(road, { fromStopId: 'other-route-stop', stops }), null);
    assert.equal(
      buildRoadRouteLine(road, { fromStopId: 's2', stops: [stop('s2', 2, null, null)] }),
      null,
    );
  });

  it('draws nothing when the next stop is nowhere near the road (stale geometry)', () => {
    // A stop moved far off the cached polyline: the engine routes through
    // every stop, so this geometry is not this stop list's road. The road
    // line refuses, and the planned legs stay the honest fallback.
    const moved = [
      stop('s1', 1, 19.05, 72.85),
      stop('s2', 2, 19.5, 72.5),
      stop('s3', 3, 19.07, 72.87),
    ];
    assert.equal(buildRoadRouteLine(road, { fromStopId: 's2', stops: moved }), null);
    assert.ok(buildPlannedLegsLine(moved, 's2'));
  });

  it('keeps the planned legs as the fallback whenever it returns null', () => {
    // The pairing that makes the swap safe: every null of the road builder
    // leaves a next stop the planned builder can still draw from — except
    // the cases where both agree there is nothing ahead (pinned above).
    assert.equal(buildRoadRouteLine(null, { fromStopId: 's2', stops }), null);
    assert.ok(buildPlannedLegsLine(stops, 's2'));
  });
});

describe('upcomingStopsFrom — what is still ahead', () => {
  const stops = [stop('s2', 2, 19.06, 72.86), stop('s1', 1, 19.05, 72.85), stop('s3', 3, 19.07, 72.87)];

  it('returns the sequence-sorted remainder from the next stop onward', () => {
    assert.deepEqual(
      upcomingStopsFrom(stops, 's2').map((stop) => stop.id),
      ['s2', 's3'],
    );
  });

  it('is empty without a next stop or with an unknown id', () => {
    assert.deepEqual(upcomingStopsFrom(stops, null), []);
    assert.deepEqual(upcomingStopsFrom(stops, 'nope'), []);
  });
});

describe('historyFixesForTrip — the trail belongs to the trip on screen', () => {
  const items = [fix(19.076, 72.8777), fix(19.079, 72.88)];
  const history = {
    trip_id: 'trip-1',
    school_id: 'school-1',
    items: items as TripLocationResponse[],
    has_more: false,
  };

  it('returns the fixes of the matching trip', () => {
    assert.equal(historyFixesForTrip(history, 'trip-1'), items);
  });

  it('returns nothing while the payload is still another trip\'s (trip switch)', () => {
    assert.deepEqual(historyFixesForTrip(history, 'trip-2'), []);
  });

  it('returns nothing without a payload or a trip', () => {
    assert.deepEqual(historyFixesForTrip(null, 'trip-1'), []);
    assert.deepEqual(historyFixesForTrip(history, null), []);
  });
});

describe('buildArrivalZonePolygon — the next stop\'s arrival zone (R1)', () => {
  it('draws the NEXT stop only, with its effective (floored) radius', () => {
    // A 10 m legacy stop: the drawn zone must be the 50 m effective circle
    // the server evaluates, never the invisible 10 m point match the field
    // run suffered.
    const stops = [
      stop('s1', 1, 19.076, 72.8777),
      stop('s2', 2, 19.079, 72.88),
      // A 10 m stop the SERVER floored to its 25 m effective radius — the map
      // draws the server's number, it no longer re-derives a floor of its own.
    ].map((entry) => ({ ...entry, geofence_radius_meters: 10, effective_radius_meters: 25 }));
    const zone = buildArrivalZonePolygon(stops, 's2');
    assert.ok(zone);
    assert.equal(zone.geometry.type, 'Polygon');
    const ring = zone.geometry.coordinates[0];
    assert.ok(ring.length > 3, 'the circle is a many-vertex polygon');
    // Closed ring (GeoJSON requirement) centred on the next stop: the first
    // and last points coincide, and every vertex keeps [lng, lat] order.
    assert.deepEqual(ring[0], ring[ring.length - 1]);
    for (const point of ring) {
      assert.ok(Math.abs(point[0] - 72.88) < 0.001, `longitude near the stop: ${point[0]}`);
      assert.ok(Math.abs(point[1] - 19.079) < 0.001, `latitude near the stop: ${point[1]}`);
    }
    // The radius is the server's effective radius, not the stored 10 m: the
    // ring's northernmost vertex sits ~25 m from the stop (0.000225°).
    const maxLatitudeDelta = Math.max(...ring.map((point) => Math.abs(point[1] - 19.079)));
    assert.ok(
      maxLatitudeDelta > 0.00017 && maxLatitudeDelta < 0.00028,
      `effective radius ~${OFFLINE_FALLBACK_MIN_RADIUS_METERS} m, got ${maxLatitudeDelta.toFixed(6)}°`,
    );
  });

  it('keeps a larger stored radius as the drawn zone', () => {
    const stops = [stop('s1', 1, 19.076, 72.8777)];
    const zone = buildArrivalZonePolygon(stops, 's1');
    assert.ok(zone);
    const ring = zone.geometry.coordinates[0];
    const maxLatitudeDelta = Math.max(...ring.map((point) => Math.abs(point[1] - 19.076)));
    // 100 m ≈ 0.0009° latitude.
    assert.ok(maxLatitudeDelta > 0.0008 && maxLatitudeDelta < 0.001);
  });

  it('draws nothing without a next stop, an unknown id, or an unsurveyed stop', () => {
    assert.equal(buildArrivalZonePolygon([stop('s1', 1, 19.076, 72.8777)], null), null);
    assert.equal(buildArrivalZonePolygon([stop('s1', 1, 19.076, 72.8777)], 'zzz'), null);
    assert.equal(buildArrivalZonePolygon([stop('s1', 1, null, null)], 's1'), null);
    assert.equal(buildArrivalZonePolygon([], 's1'), null);
  });
});
