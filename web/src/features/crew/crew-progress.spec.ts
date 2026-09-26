import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  KID_ROW_WINDOW,
  TRAIL_MAX_POINTS,
  appendTrailPoint,
  deriveNextStop,
  stopCounterOf,
  stopStateOf,
  summarizeStopKids,
  type TrailPoint,
} from './crew-progress.ts';
import {
  TripAttendanceStatus,
  type StopResponse,
  type TripEtaResponse,
  type TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';

/**
 * Crew-page derivations (crew-progress.ts) — the React-free logic behind the
 * next-stop card, the stops table and the driven-path map line.
 *
 * Pins the decisions that must never depend on render order or a stale
 * closure: which stop is next (server frontier first, route-order fallback),
 * what state each stop is in, who still waits where, and how the GPS trail
 * grows without churning React state or memory.
 */

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
  status: TripAttendanceStatus,
  name: { first?: string; last?: string } = {},
): TripStudentAttendanceResponse =>
  ({
    student_id: `student-${n}`,
    first_name: name.first ?? `Kid${n}`,
    last_name: name.last ?? 'Test',
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

  it('the arrival record wins over the ETA flag when both exist', () => {
    // The server stores one row per stop, so a skip IS the arrival record —
    // a stale ETA snapshot must not repaint the stop as merely arrived.
    const arrivals = [{ stop_id: 'stop-1', skip_reason: 'no kids waiting' }];
    assert.equal(stopStateOf('stop-1', arrivals, etaWithNext(null, ['stop-1']).items), 'skipped');
  });

  it('falls back to the live ETA arrived flag when no record was fetched', () => {
    assert.equal(stopStateOf('stop-1', [], etaWithNext(null, ['stop-1']).items), 'arrived');
    assert.equal(stopStateOf('stop-2', [], etaWithNext(null, ['stop-1']).items), 'pending');
  });

  it('is pending with no record and no ETA data at all', () => {
    assert.equal(stopStateOf('stop-1', []), 'pending');
    assert.equal(stopStateOf('stop-1', [], null), 'pending');
    assert.equal(stopStateOf('stop-1', [], []), 'pending');
  });
});

describe('deriveNextStop', () => {
  const stops = [routeStop(3), routeStop(1), routeStop(2)];

  it('trusts the server next stop while it is unserved', () => {
    const next = deriveNextStop(stops, etaWithNext('stop-2'), []);
    assert.equal(next?.id, 'stop-2');
  });

  it('advances past a server next stop that was already skipped', () => {
    const next = deriveNextStop(stops, etaWithNext('stop-1'), [
      { stop_id: 'stop-1', skip_reason: 'closed' },
    ]);
    assert.equal(next?.id, 'stop-2');
  });

  it('advances past a server next stop that was already arrived', () => {
    const next = deriveNextStop(stops, etaWithNext('stop-1'), [
      { stop_id: 'stop-1', skip_reason: null },
    ]);
    assert.equal(next?.id, 'stop-2');
  });

  it('advances past a server next stop the ETA itself already flags arrived', () => {
    // Geofence recorded the arrival but the page has not refetched arrivals.
    const next = deriveNextStop(stops, etaWithNext('stop-1', ['stop-1']), []);
    assert.equal(next?.id, 'stop-2');
  });

  it('picks the first unserved stop in route order, not array order', () => {
    // Input deliberately unsorted: [3, 1, 2] by sequence_number.
    const next = deriveNextStop(stops, null, []);
    assert.equal(next?.id, 'stop-1');
  });

  it('falls back to the first pending stop in route order before any GPS', () => {
    const next = deriveNextStop(stops, null, [{ stop_id: 'stop-1', skip_reason: null }]);
    assert.equal(next?.id, 'stop-2');
  });

  it('ignores a server next stop that is not part of the route', () => {
    const next = deriveNextStop(stops, etaWithNext('stop-999'), [
      { stop_id: 'stop-1', skip_reason: null },
    ]);
    assert.equal(next?.id, 'stop-2');
  });

  it('returns null when every stop is served (mixed arrivals and skips)', () => {
    const arrivals = [
      { stop_id: 'stop-1', skip_reason: null },
      { stop_id: 'stop-2', skip_reason: 'road closed' },
      { stop_id: 'stop-3', skip_reason: null },
    ];
    assert.equal(deriveNextStop(stops, null, arrivals), null);
    assert.equal(deriveNextStop(stops, etaWithNext('stop-2'), arrivals), null);
  });

  it('returns null for an empty route', () => {
    assert.equal(deriveNextStop([], null, []), null);
    assert.equal(deriveNextStop([], etaWithNext('stop-1'), []), null);
  });
});

describe('stopCounterOf', () => {
  it('is 1-based over route order, independent of input order', () => {
    const stops = [routeStop(3), routeStop(1), routeStop(2)];
    assert.deepEqual(stopCounterOf(stops, 'stop-1'), { position: 1, total: 3 });
    assert.deepEqual(stopCounterOf(stops, 'stop-2'), { position: 2, total: 3 });
    assert.deepEqual(stopCounterOf(stops, 'stop-3'), { position: 3, total: 3 });
  });

  it('reports position 0 for a stop that is not on the route', () => {
    const stops = [routeStop(1), routeStop(2), routeStop(3)];
    assert.deepEqual(stopCounterOf(stops, 'missing'), { position: 0, total: 3 });
    assert.deepEqual(stopCounterOf([], 'stop-1'), { position: 0, total: 0 });
  });
});

describe('summarizeStopKids', () => {
  it('counts assigned vs still-waiting kids at the stop', () => {
    const students = [
      student(1, 'stop-1', TripAttendanceStatus.PENDING),
      student(2, 'stop-1', TripAttendanceStatus.BOARDED),
      student(3, 'stop-1', TripAttendanceStatus.DROPPED),
      student(4, 'stop-2', TripAttendanceStatus.PENDING),
    ];
    const summary = summarizeStopKids(students, 'stop-1');
    assert.equal(summary.total, 3);
    assert.equal(summary.waiting, 1);
    assert.deepEqual(summary.waitingNames, ['Kid1 Test']);
    assert.equal(summary.hiddenWaiting, 0);
  });

  it('lists only PENDING kids as waiting, in manifest order', () => {
    const students = [
      student(1, 'stop-1', TripAttendanceStatus.BOARDED),
      student(2, 'stop-1', TripAttendanceStatus.PENDING),
      student(3, 'stop-1', TripAttendanceStatus.PENDING),
    ];
    const summary = summarizeStopKids(students, 'stop-1');
    assert.deepEqual(summary.waitingNames, ['Kid2 Test', 'Kid3 Test']);
  });

  it('windows waiting lists at KID_ROW_WINDOW and reports the hidden count', () => {
    assert.equal(KID_ROW_WINDOW, 8);
    const students = Array.from({ length: 12 }, (_, index) =>
      student(index + 1, 'stop-1', TripAttendanceStatus.PENDING),
    );
    const summary = summarizeStopKids(students, 'stop-1');
    assert.equal(summary.total, 12);
    assert.equal(summary.waiting, 12);
    assert.equal(summary.waitingNames.length, KID_ROW_WINDOW);
    assert.deepEqual(summary.waitingNames[0], 'Kid1 Test');
    assert.deepEqual(summary.waitingNames[KID_ROW_WINDOW - 1], 'Kid8 Test');
    assert.equal(summary.hiddenWaiting, 4);
  });

  it('shows no hidden count at exactly the window size', () => {
    const students = Array.from({ length: KID_ROW_WINDOW }, (_, index) =>
      student(index + 1, 'stop-1', TripAttendanceStatus.PENDING),
    );
    const summary = summarizeStopKids(students, 'stop-1');
    assert.equal(summary.waitingNames.length, KID_ROW_WINDOW);
    assert.equal(summary.hiddenWaiting, 0);
  });

  it('is all zeros for a stop with no assigned kids', () => {
    const summary = summarizeStopKids([student(1, 'stop-2', TripAttendanceStatus.PENDING)], 'stop-1');
    assert.deepEqual(summary, { total: 0, waiting: 0, waitingNames: [], hiddenWaiting: 0 });
  });

  it('trims a missing last name out of the display name', () => {
    const students = [student(1, 'stop-1', TripAttendanceStatus.PENDING, { first: 'Asha', last: '' })];
    assert.deepEqual(summarizeStopKids(students, 'stop-1').waitingNames, ['Asha']);
  });
});

describe('appendTrailPoint', () => {
  it('appends new points in order', () => {
    let trail: readonly TrailPoint[] = [];
    trail = appendTrailPoint(trail, { latitude: 19, longitude: 72 });
    trail = appendTrailPoint(trail, { latitude: 19.001, longitude: 72.001 });
    assert.deepEqual(trail, [
      { latitude: 19, longitude: 72 },
      { latitude: 19.001, longitude: 72.001 },
    ]);
  });

  it('returns the same array reference for a non-finite point (React stability)', () => {
    const trail: readonly TrailPoint[] = [{ latitude: 19, longitude: 72 }];
    assert.equal(appendTrailPoint(trail, { latitude: Number.NaN, longitude: 72 }), trail);
    assert.equal(appendTrailPoint(trail, { latitude: 19, longitude: Number.POSITIVE_INFINITY }), trail);
    assert.equal(appendTrailPoint([], { latitude: Number.NaN, longitude: Number.NaN }).length, 0);
  });

  it('returns the same array reference for a duplicate consecutive point', () => {
    const trail = appendTrailPoint([], { latitude: 19, longitude: 72 });
    assert.equal(appendTrailPoint(trail, { latitude: 19, longitude: 72 }), trail);
    // Only *consecutive* duplicates are dropped: returning to a point later is real movement.
    const away = appendTrailPoint(trail, { latitude: 19.001, longitude: 72 });
    const back = appendTrailPoint(away, { latitude: 19, longitude: 72 });
    assert.equal(back.length, 3);
  });

  it('caps the trail by dropping the oldest points from the front', () => {
    let capped: readonly TrailPoint[] = [];
    for (let index = 0; index < 6; index += 1) {
      capped = appendTrailPoint(capped, { latitude: index, longitude: index }, 4);
    }
    assert.equal(capped.length, 4);
    assert.equal(capped[0].latitude, 2);
    assert.equal(capped[capped.length - 1].latitude, 5);
  });

  it('defaults the cap to TRAIL_MAX_POINTS', () => {
    let trail: readonly TrailPoint[] = [];
    for (let index = 0; index < TRAIL_MAX_POINTS + 5; index += 1) {
      trail = appendTrailPoint(trail, { latitude: index, longitude: 0 });
    }
    assert.equal(trail.length, TRAIL_MAX_POINTS);
    assert.equal(trail[0].latitude, 5, 'the 5 oldest points fell off the back');
    assert.equal(trail[trail.length - 1].latitude, TRAIL_MAX_POINTS + 4);
  });
});
