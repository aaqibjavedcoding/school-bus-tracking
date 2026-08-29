import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { EtaService } from './eta.service';
import {
  DEFAULT_ETA_CONFIG,
  DEFAULT_STOPS,
  ROUTE_A,
  SCHOOL_A,
  SCHOOL_B,
  STOP_1,
  STOP_2,
  STOP_3,
  TRIP_A,
  makeArrival,
  makeEtaService,
  makeFix,
  makeStop,
  makeStopsRepo,
  makeTrip,
} from './eta.test-utils';

const closeTo = (actual: number | null, expected: number, tolerance: number): void => {
  assert.ok(actual !== null, 'expected a numeric value');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

describe('EtaService.computeTripEta', () => {
  it('computes an approximate ETA for the upcoming stops with the GPS speed', async () => {
    const service = makeEtaService(DEFAULT_STOPS, []);
    const trip = makeTrip({ id: TRIP_A, status: TripStatus.IN_PROGRESS });
    const fix = makeFix({ speed: 25, latitude: 40.7003, longitude: -73.9997 });

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.eta_available, true);
    assert.equal(eta.speed_kmh, 25);
    assert.equal(eta.speed_source, 'gps');
    assert.equal(eta.current_stop, null);
    assert.equal(eta.next_stop?.stop_id, STOP_1);
    assert.equal(eta.items.length, 3);

    // Bus is ~41 m from stop 1 → 0.1 min → rounds up to 1 minute.
    assert.equal(eta.items[0].eta_minutes, 1);
    // Stop 2 is ~885 m along the polyline → 25 km/h ≈ 417 m/min → 3 minutes.
    closeTo(eta.items[0].distance_meters ?? -1, 41, 2);
    closeTo(eta.items[1].distance_meters ?? -1, 885, 10);
    assert.equal(eta.items[1].eta_minutes, 3);
    assert.equal(eta.items[0].arrived, false);
  });

  it('falls back to the configured speed when the GPS speed is zero/unavailable', async () => {
    const service = makeEtaService(DEFAULT_STOPS, []);
    const trip = makeTrip();
    const fix = makeFix({ speed: 0 });

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.speed_kmh, DEFAULT_ETA_CONFIG.fallbackSpeedKmh);
    assert.equal(eta.speed_source, 'fallback');
    assert.equal(eta.eta_available, true);
    // 41 m at 25 km/h still rounds up to 1 minute.
    assert.equal(eta.next_stop?.eta_minutes, 1);

    const nullSpeed = await service.computeTripEta({ trip, latest: makeFix({ speed: null }) });
    assert.equal(nullSpeed.speed_source, 'fallback');
    assert.equal(nullSpeed.speed_kmh, DEFAULT_ETA_CONFIG.fallbackSpeedKmh);
  });

  it('never fabricates an ETA without a GPS fix', async () => {
    const service = makeEtaService(DEFAULT_STOPS, []);
    const trip = makeTrip();

    const eta = await service.computeTripEta({ trip, latest: null });

    assert.equal(eta.eta_available, false);
    assert.equal(eta.latest, null);
    assert.equal(eta.speed_kmh, null);
    assert.equal(eta.speed_source, null);
    // Stops are still listed (progress), but with no distances or ETAs.
    assert.equal(eta.items.length, 3);
    for (const item of eta.items) {
      assert.equal(item.distance_meters, null);
      assert.equal(item.eta_minutes, null);
    }
  });

  it('advances current/next stop from the recorded arrivals', async () => {
    const service = makeEtaService(DEFAULT_STOPS, [
      makeArrival({ stop_id: STOP_1, arrived_at: new Date('2026-09-01T06:40:00.000Z') }),
    ]);
    const trip = makeTrip();
    const fix = makeFix({ latitude: 40.7001, longitude: -73.99 });

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.current_stop?.stop_id, STOP_1);
    assert.equal(eta.current_stop?.arrived, true);
    assert.equal(eta.current_stop?.distance_meters, null);
    assert.equal(eta.current_stop?.eta_minutes, null);
    assert.equal(eta.next_stop?.stop_id, STOP_2);
    // Distance starts at the bus → stop 2 (not via stop 1).
    assert.ok(eta.next_stop?.distance_meters !== null);
    assert.ok((eta.next_stop?.distance_meters ?? 0) < 60);
    assert.equal(eta.next_stop?.eta_minutes, 1);
  });

  it('reports next_stop as null once every stop has arrived', async () => {
    const service = makeEtaService(DEFAULT_STOPS, [
      makeArrival({ stop_id: STOP_1 }),
      makeArrival({ stop_id: STOP_2 }),
      makeArrival({ stop_id: STOP_3 }),
    ]);
    const trip = makeTrip();
    const fix = makeFix();

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.current_stop?.stop_id, STOP_3);
    assert.equal(eta.next_stop, null);
    assert.ok(eta.items.every((item) => item.arrived));
  });

  it('keeps distances along the stop polyline (bus → next → following stops)', async () => {
    const service = makeEtaService(DEFAULT_STOPS, []);
    const trip = makeTrip();
    const fix = makeFix({ latitude: 40.7, longitude: -74.0 }); // exactly at stop 1

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.items[0].distance_meters, 0);
    closeTo(eta.items[1].distance_meters ?? -1, 842, 8);
    closeTo(eta.items[2].distance_meters ?? -1, 1684, 16);
  });

  it('skips stops without coordinates instead of inventing distances', async () => {
    const stops = [
      makeStop({ id: STOP_1, sequence_number: 1, latitude: 40.7, longitude: -74.0 }),
      makeStop({ id: STOP_2, sequence_number: 2, latitude: null, longitude: null }),
      makeStop({ id: STOP_3, sequence_number: 3, latitude: 40.7, longitude: -73.98 }),
    ];
    const service = makeEtaService(stops, []);
    const trip = makeTrip();
    const fix = makeFix({ latitude: 40.7, longitude: -74.0 });

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.items[1].distance_meters, null);
    assert.equal(eta.items[1].eta_minutes, null);
    // The path continues from the last known point for the following stop.
    closeTo(eta.items[2].distance_meters ?? -1, 1684, 16);
  });

  it('pins every lookup to the trip tenant (cross-school isolation)', async () => {
    const stopsStore = makeStopsRepo([
      ...DEFAULT_STOPS,
      // A stop of another school sharing the same route id must never leak in.
      makeStop({
        id: '22222222-2222-4222-8222-222222220005',
        school_id: SCHOOL_B,
        route_id: ROUTE_A,
        name: 'Other School Stop',
        sequence_number: 0,
      }),
    ]);
    const service = new EtaService(
      stopsStore.repo as never,
      { findAll: async () => [] } as never,
      DEFAULT_ETA_CONFIG,
    );
    const trip = makeTrip({ school_id: SCHOOL_A, route_id: ROUTE_A });
    const fix = makeFix();

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.items.length, 3);
    for (const query of stopsStore.queries) {
      assert.equal(query['school_id'], SCHOOL_A);
      assert.equal(query['route_id'], ROUTE_A);
    }
  });

  it('clamps a bogus device speed and still produces an ETA', async () => {
    const service = makeEtaService(DEFAULT_STOPS, []);
    const trip = makeTrip();
    const fix = makeFix({ speed: 500 });

    const eta = await service.computeTripEta({ trip, latest: fix });

    assert.equal(eta.speed_kmh, 90);
    assert.equal(eta.speed_source, 'gps');
    assert.equal(eta.next_stop?.eta_minutes, 1);
  });
});
