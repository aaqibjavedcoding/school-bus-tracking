import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { StopResponse, TripLocationResponse } from '@school-bus-tracking/shared-types';

import {
  buildPlannedLegsLine,
  buildTrailLine,
  historyFixesForTrip,
  upcomingStopsFrom,
} from './trip-map-geometry.ts';

/**
 * The driver map's two honest lines, pinned.
 *
 * - the trail may only ever be built from recorded fixes;
 * - the planned line may only ever start at the **next stop the screen was
 *   given** — the map never picks one — and may only reach stops with real
 *   coordinates;
 * - both prefer "draw nothing" (`null`) over drawing a wrong or implied line.
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
