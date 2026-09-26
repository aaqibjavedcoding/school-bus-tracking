import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  MAX_URL_LENGTH,
  MAX_WAYPOINTS_PER_URL,
  buildCrewRouteUrl,
  buildDirectionsUrl,
  buildDirectionsUrlChunks,
  filterNavigableTargets,
  formatLatLng,
  isNavigableStop,
  isValidCoordinate,
  navigationTargetOf,
  type NavigableStopLike,
  type NavigationTarget,
} from './navigation.ts';
import {
  appendTrailPoint,
  deriveNextStop,
  stopCounterOf,
  stopStateOf,
  summarizeStopKids,
} from './crew-progress.ts';
import type {
  StopResponse,
  TripEtaResponse,
  TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';

/**
 * Web crew navigation hand-off contract.
 *
 * Pins the same rules `mobile/src/lib/navigation-directions.spec.ts` pins on
 * mobile — the two builders must stay byte-identical so a driver switching
 * between phone and web console lands in the same Google Maps guidance:
 * a bad coordinate is never linked, no origin is ever sent, waypoints are
 * capped and chunked without losing or reordering a stop. Plus the crew-page
 * derivations (next stop, per-stop state, waiting kids, driven trail) that
 * feed the card, the table and the map.
 */

const target = (n: number): NavigationTarget => ({
  name: `Stop ${n}`,
  latitude: 19.0 + n / 1000,
  longitude: 72.8 + n / 1000,
});

const route = (count: number): NavigationTarget[] =>
  Array.from({ length: count }, (_, index) => target(index + 1));

const stopLike = (n: number, coords = true): NavigableStopLike => ({
  id: `stop-${n}`,
  name: `Stop ${n}`,
  sequence_number: n,
  latitude: coords ? 19.0 + n / 1000 : null,
  longitude: coords ? 72.8 + n / 1000 : null,
});

describe('isValidCoordinate', () => {
  it('accepts in-range coordinates and rejects NaN / out-of-range ones', () => {
    assert.equal(isValidCoordinate(19.076, 72.8777), true);
    assert.equal(isValidCoordinate(-90, 180), true);
    assert.equal(isValidCoordinate(90.0001, 0), false);
    assert.equal(isValidCoordinate(0, -180.5), false);
    assert.equal(isValidCoordinate(Number.NaN, 72), false);
    assert.equal(isValidCoordinate(19, Number.POSITIVE_INFINITY), false);
  });
});

describe('formatLatLng', () => {
  it('writes a bare lat,lng pair (no percent-encoded comma)', () => {
    assert.equal(formatLatLng(19.076, 72.8777), '19.076,72.8777');
  });

  it('caps precision at six decimals', () => {
    assert.equal(formatLatLng(19.07612345678, 72.87765432), '19.076123,72.877654');
  });
});

describe('buildDirectionsUrl', () => {
  it('builds the documented navigate link without an origin (same as mobile)', () => {
    const url = buildDirectionsUrl({ destination: target(1), travelmode: 'driving' });
    assert.equal(
      url,
      'https://www.google.com/maps/dir/?api=1&destination=19.001,72.801&travelmode=driving&dir_action=navigate',
    );
    // The map app must use the device's live position, so no origin is sent.
    assert.equal(url!.includes('origin='), false);
  });

  it('defaults the travel mode to driving', () => {
    assert.match(buildDirectionsUrl({ destination: target(1) })!, /travelmode=driving/);
  });

  it('joins waypoints with | in route order', () => {
    const url = buildDirectionsUrl({ destination: target(1), waypoints: [target(2), target(3)] });
    assert.match(url!, /waypoints=19\.002,72\.802\|19\.003,72\.803/);
  });

  it('caps waypoints at the URL-API limit', () => {
    const url = buildDirectionsUrl({ destination: target(1), waypoints: route(20).slice(1) });
    const waypoints = /waypoints=([^&]+)/.exec(url!)![1].split('|');
    assert.equal(waypoints.length, MAX_WAYPOINTS_PER_URL);
  });

  it('drops invalid waypoints but never an invalid destination', () => {
    const bad: NavigationTarget = { name: 'bad', latitude: Number.NaN, longitude: 72.8 };
    const url = buildDirectionsUrl({ destination: target(1), waypoints: [bad, target(2)] });
    assert.match(url!, /waypoints=19\.002,72\.802/);
    assert.equal(buildDirectionsUrl({ destination: bad }), null);
  });
});

describe('buildDirectionsUrlChunks', () => {
  it('returns one chunk for a short route', () => {
    const chunks = buildDirectionsUrlChunks({
      destination: target(1),
      waypoints: route(5).slice(1),
    });
    assert.equal(chunks.length, 1);
  });

  it('splits a long route without losing or reordering a stop', () => {
    const stops = route(23);
    const chunks = buildDirectionsUrlChunks({ destination: stops[0], waypoints: stops.slice(1) });
    assert.ok(chunks.length > 1);
    const seen: string[] = [];
    for (const chunk of chunks) {
      assert.ok(chunk.length <= MAX_URL_LENGTH);
      const destination = /destination=([^&]+)/.exec(chunk)![1];
      const waypoints = /waypoints=([^&]+)/.exec(chunk)?.[1]?.split('|') ?? [];
      seen.push(destination, ...waypoints);
    }
    assert.deepEqual(
      seen,
      stops.map((point) => formatLatLng(point.latitude, point.longitude)),
    );
  });

  it('returns [] when nothing is navigable', () => {
    const bad: NavigationTarget = { name: 'bad', latitude: 91, longitude: 0 };
    assert.deepEqual(buildDirectionsUrlChunks({ destination: bad }), []);
  });
});

describe('filterNavigableTargets / navigationTargetOf', () => {
  it('drops targets with unusable coordinates', () => {
    const bad: NavigationTarget = { name: 'bad', latitude: 91, longitude: 0 };
    assert.deepEqual(filterNavigableTargets([bad, target(1)]), [target(1)]);
    assert.deepEqual(filterNavigableTargets(undefined), []);
  });

  it('a stop without coordinates is not a navigation target', () => {
    assert.equal(navigationTargetOf(stopLike(1, false)), null);
    assert.equal(isNavigableStop(stopLike(1, false)), false);
    assert.deepEqual(navigationTargetOf(stopLike(2)), target(2));
  });
});

describe('buildCrewRouteUrl', () => {
  it('navigates to the next stop with the remaining stops as ordered waypoints', () => {
    const url = buildCrewRouteUrl(stopLike(2), [stopLike(4), stopLike(3)]);
    assert.match(url!, /destination=19\.002,72\.802/);
    // Waypoints re-sorted into route order regardless of input order.
    assert.match(url!, /waypoints=19\.003,72\.803\|19\.004,72\.804/);
    assert.match(url!, /dir_action=navigate/);
  });

  it('excludes the next stop itself from the waypoints', () => {
    const url = buildCrewRouteUrl(stopLike(2), [stopLike(2), stopLike(3)]);
    assert.match(url!, /waypoints=19\.003,72\.803(&|$)/);
  });

  it('skips unsurveyed upcoming stops but returns null for an unsurveyed destination', () => {
    const url = buildCrewRouteUrl(stopLike(1), [stopLike(2, false), stopLike(3)]);
    assert.match(url!, /waypoints=19\.003,72\.803/);
    assert.equal(buildCrewRouteUrl(stopLike(1, false), [stopLike(2)]), null);
  });
});

/* ------------------------------------------------------------------ *
 * Crew-page derivations (crew-progress.ts)
 * ------------------------------------------------------------------ */

const routeStop = (n: number, coords = true): StopResponse => ({
  id: `stop-${n}`,
  school_id: 'school-1',
  route_id: 'route-1',
  name: `Stop ${n}`,
  address: null,
  latitude: coords ? 19.0 + n / 1000 : null,
  longitude: coords ? 72.8 + n / 1000 : null,
  geofence_radius_meters: 100,
  sequence_number: n,
  estimated_arrival_time: null,
  is_active: true,
  created_at: '2026-09-26T00:00:00.000Z',
  updated_at: '2026-09-26T00:00:00.000Z',
});

const etaWithNext = (nextId: string | null, arrivedIds: string[] = []): TripEtaResponse =>
  ({
    next_stop: nextId
      ? {
          stop_id: nextId,
          stop_name: nextId,
          sequence_number: 0,
          distance_meters: null,
          eta_minutes: null,
          arrived: false,
        }
      : null,
    items: arrivedIds.map((stopId, index) => ({
      stop_id: stopId,
      stop_name: stopId,
      sequence_number: index + 1,
      distance_meters: null,
      eta_minutes: null,
      arrived: true,
    })),
  }) as unknown as TripEtaResponse;

const student = (
  n: number,
  stopId: string,
  status: TripStudentAttendanceResponse['status'],
): TripStudentAttendanceResponse =>
  ({
    student_id: `student-${n}`,
    first_name: `Kid${n}`,
    last_name: 'Test',
    stop_id: stopId,
    status,
  }) as unknown as TripStudentAttendanceResponse;

describe('stopStateOf', () => {
  it('reads skipped vs arrived from the arrival record', () => {
    const arrivals = [
      { stop_id: 'stop-1', skip_reason: null },
      { stop_id: 'stop-2', skip_reason: 'road closed' },
    ];
    assert.equal(stopStateOf('stop-1', arrivals), 'arrived');
    assert.equal(stopStateOf('stop-2', arrivals), 'skipped');
    assert.equal(stopStateOf('stop-3', arrivals), 'pending');
  });

  it('falls back to the live ETA arrived flag when no record was fetched', () => {
    assert.equal(stopStateOf('stop-1', [], etaWithNext(null, ['stop-1']).items), 'arrived');
    assert.equal(stopStateOf('stop-2', [], etaWithNext(null, ['stop-1']).items), 'pending');
  });
});

describe('deriveNextStop', () => {
  const stops = [routeStop(3), routeStop(1), routeStop(2)];

  it('trusts the server next stop while it is unserved', () => {
    const next = deriveNextStop(stops, etaWithNext('stop-2'), []);
    assert.equal(next?.id, 'stop-2');
  });

  it('never picks a stop that is already arrived or skipped', () => {
    const next = deriveNextStop(stops, etaWithNext('stop-1'), [
      { stop_id: 'stop-1', skip_reason: 'closed' },
    ]);
    assert.equal(next?.id, 'stop-2');
  });

  it('falls back to the first pending stop in route order before any GPS', () => {
    const next = deriveNextStop(stops, null, [{ stop_id: 'stop-1', skip_reason: null }]);
    assert.equal(next?.id, 'stop-2');
  });

  it('returns null when every stop is served', () => {
    const arrivals = stops.map((stop) => ({ stop_id: stop.id, skip_reason: null }));
    assert.equal(deriveNextStop(stops, null, arrivals), null);
    assert.equal(deriveNextStop([], null, []), null);
  });
});

describe('stopCounterOf', () => {
  it('is 1-based over route order, independent of input order', () => {
    const stops = [routeStop(3), routeStop(1), routeStop(2)];
    assert.deepEqual(stopCounterOf(stops, 'stop-2'), { position: 2, total: 3 });
    assert.deepEqual(stopCounterOf(stops, 'missing'), { position: 0, total: 3 });
  });
});

describe('summarizeStopKids', () => {
  it('counts assigned vs still-waiting kids at the stop', () => {
    const students = [
      student(1, 'stop-1', 'PENDING' as TripStudentAttendanceResponse['status']),
      student(2, 'stop-1', 'BOARDED' as TripStudentAttendanceResponse['status']),
      student(3, 'stop-2', 'PENDING' as TripStudentAttendanceResponse['status']),
    ];
    const summary = summarizeStopKids(students, 'stop-1');
    assert.equal(summary.total, 2);
    assert.equal(summary.waiting, 1);
    assert.deepEqual(summary.waitingNames, ['Kid1 Test']);
    assert.equal(summary.hiddenWaiting, 0);
  });

  it('windows long waiting lists and reports the hidden count', () => {
    const students = Array.from({ length: 12 }, (_, index) =>
      student(index + 1, 'stop-1', 'PENDING' as TripStudentAttendanceResponse['status']),
    );
    const summary = summarizeStopKids(students, 'stop-1');
    assert.equal(summary.waiting, 12);
    assert.equal(summary.waitingNames.length, 8);
    assert.equal(summary.hiddenWaiting, 4);
  });
});

describe('appendTrailPoint', () => {
  it('appends new points and dedupes exact repeats (same array back)', () => {
    const first = appendTrailPoint([], { latitude: 19, longitude: 72 });
    assert.equal(first.length, 1);
    const same = appendTrailPoint(first, { latitude: 19, longitude: 72 });
    assert.equal(same, first);
    const grown = appendTrailPoint(first, { latitude: 19.001, longitude: 72.001 });
    assert.equal(grown.length, 2);
  });

  it('ignores non-finite points and caps the trail length from the front', () => {
    const trail = appendTrailPoint([], { latitude: Number.NaN, longitude: 72 });
    assert.equal(trail.length, 0);
    let capped: readonly { latitude: number; longitude: number }[] = [];
    for (let index = 0; index < 6; index += 1) {
      capped = appendTrailPoint(capped, { latitude: index, longitude: index }, 4);
    }
    assert.equal(capped.length, 4);
    assert.equal(capped[0].latitude, 2);
    assert.equal(capped[capped.length - 1].latitude, 5);
  });
});
