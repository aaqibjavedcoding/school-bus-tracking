import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StopResponse, TripEtaResponse, TripStopEta } from '@school-bus-tracking/shared-types';
import {
  navigationTargetOf,
  pickNextStop,
  deriveFrontier,
  deriveTripProgress,
} from './navigation-stop.ts';

const stop = (overrides: Partial<StopResponse> = {}): StopResponse =>
  ({
    id: 'stop-1',
    school_id: 'school-1',
    route_id: 'route-1',
    name: 'Main gate',
    sequence_number: 1,
    latitude: 19.076,
    longitude: 72.8777,
    arrival_time: null,
    departure_time: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as StopResponse;

const etaItem = (overrides: Partial<TripStopEta> = {}): TripStopEta => ({
  stop_id: 'stop-1',
  stop_name: 'Main gate',
  sequence_number: 1,
  distance_meters: 100,
  eta_minutes: 1,
  arrived: false,
  ...overrides,
});

const etaResponse = (items: TripStopEta[], next: TripStopEta | null = null): TripEtaResponse =>
  ({
    trip_id: 'trip-1',
    school_id: 'school-1',
    trip_status: 'IN_PROGRESS' as never,
    tracking_state: 'active' as never,
    latest: null,
    speed_kmh: 20,
    speed_source: 'gps',
    current_stop: items.find((i) => i.arrived) ?? null,
    next_stop: next,
    items,
    eta_available: true,
    warnings: [],
  }) as TripEtaResponse;

describe('crew navigation stop selection', () => {
  it('accepts a stop with real in-range coordinates', () => {
    assert.deepEqual(navigationTargetOf(stop()), {
      name: 'Main gate',
      latitude: 19.076,
      longitude: 72.8777,
    });
  });

  it('rejects a stop that has not been geofenced', () => {
    assert.equal(navigationTargetOf(stop({ latitude: null, longitude: null })), null);
  });

  it('rejects out-of-range coordinates rather than building a bad URL', () => {
    assert.equal(navigationTargetOf(stop({ latitude: 999, longitude: 72.8777 })), null);
    assert.equal(navigationTargetOf(stop({ latitude: 19.076, longitude: -500 })), null);
    assert.equal(navigationTargetOf(stop({ latitude: Number.NaN, longitude: 0 })), null);
  });

  it('prefers the stop the server reported as next', () => {
    const stops = [stop({ id: 'a', sequence_number: 1 }), stop({ id: 'b', sequence_number: 2 })];
    assert.equal(pickNextStop(stops, 'b')?.id, 'b');
  });

  it('falls back to the first geofenced stop when the reported one has no coordinates', () => {
    const stops = [
      stop({ id: 'a', latitude: null, longitude: null }),
      stop({ id: 'b', sequence_number: 2 }),
    ];
    assert.equal(pickNextStop(stops, 'a')?.id, 'b');
  });

  it('returns null when no stop can be navigated to', () => {
    assert.equal(pickNextStop([]), null);
    assert.equal(pickNextStop([stop({ latitude: null, longitude: null })]), null);
  });

  it('returns the first navigable stop when no next stop is known', () => {
    const stops = [
      stop({ id: 'a', latitude: null, longitude: null }),
      stop({ id: 'b', sequence_number: 2 }),
      stop({ id: 'c', sequence_number: 3 }),
    ];
    assert.equal(pickNextStop(stops)?.id, 'b');
  });
});

describe('field-hardened trip progress (3E)', () => {
  it('derives frontier as max arrived sequence', () => {
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: true }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false }),
    ];
    assert.equal(deriveFrontier(items), 2);
    assert.equal(deriveFrontier([]), 0);
    assert.equal(deriveFrontier(null), 0);
  });

  it('monotonic: frontier never goes backward even if server sends earlier', () => {
    const stops = [
      stop({ id: 'a', sequence_number: 1 }),
      stop({ id: 'b', sequence_number: 2 }),
      stop({ id: 'c', sequence_number: 3 }),
    ];
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: true }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false }),
    ];
    const eta = etaResponse(items, items[2]);
    // First call advances frontier to 2
    const first = deriveTripProgress(stops, eta, 'c', 0);
    assert.equal(first.frontier, 2);
    assert.equal(first.nextStop?.id, 'c');

    // Server now says only stop 1 arrived (out-of-order), but previous frontier 2 must hold
    const earlierItems = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: false }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false }),
    ];
    const earlierEta = etaResponse(earlierItems, earlierItems[1]);
    const second = deriveTripProgress(stops, earlierEta, 'b', first.frontier);
    assert.equal(second.frontier, 2, 'frontier must not retreat');
    assert.equal(second.nextStop?.id, 'c', 'next must stay ahead of frontier, not jump back to b');
  });

  it('never returns a stop behind frontier as next (no backward jump)', () => {
    const stops = [
      stop({ id: 'a', sequence_number: 1 }),
      stop({ id: 'b', sequence_number: 2 }),
      stop({ id: 'c', sequence_number: 3 }),
    ];
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: true }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false }),
    ];
    const eta = etaResponse(items, items[2]);
    // Server incorrectly says next is 'a' (behind frontier) — must be ignored
    const derived = deriveTripProgress(stops, eta, 'a', 0);
    assert.notEqual(derived.nextStop?.id, 'a');
    assert.equal(derived.nextStop?.id, 'c');
    assert.ok(derived.reason.includes('behind frontier'));
  });

  it('returns null when all navigable stops arrived (no jump to first)', () => {
    const stops = [
      stop({ id: 'a', sequence_number: 1 }),
      stop({ id: 'b', sequence_number: 2 }),
    ];
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: true }),
    ];
    const eta = etaResponse(items, null);
    const derived = deriveTripProgress(stops, eta, null, 0);
    assert.equal(derived.nextStop, null, 'trip complete should be null, not first');
    assert.equal(derived.frontier, 2);
  });

  it('nearest-upcoming: when ETA distances available, picks closest ahead', () => {
    const stops = [
      stop({ id: 'a', sequence_number: 1, latitude: 19.0, longitude: 72.0 }),
      stop({ id: 'b', sequence_number: 2, latitude: 19.1, longitude: 72.1 }),
      stop({ id: 'c', sequence_number: 3, latitude: 19.2, longitude: 72.2 }),
    ];
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true, distance_meters: null }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: false, distance_meters: 500 }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false, distance_meters: 100 }),
    ];
    const eta = etaResponse(items, items[2]);
    // Both b and c ahead, but c is closer (100m vs 500m) — should pick c as nearest upcoming
    const derived = deriveTripProgress(stops, eta, null, 1);
    assert.equal(derived.nextStop?.id, 'c');
  });

  it('handles GPS jumps: far-ahead arrival with drift should not surface random last as next if intermediate missing', () => {
    const stops = [
      stop({ id: 'a', sequence_number: 1 }),
      stop({ id: 'b', sequence_number: 2 }),
      stop({ id: 'c', sequence_number: 3 }),
      stop({ id: 'd', sequence_number: 4 }),
      stop({ id: 'e', sequence_number: 5 }),
    ];
    // Simulate drift: server says stop e (last) arrived, but b,c,d never arrived
    // Frontier becomes 5, no candidates → null (trip appears complete)
    // This is server's decision; client must not fallback to first (a) which would be random jump
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: false }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: false }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false }),
      etaItem({ stop_id: 'd', sequence_number: 4, arrived: false }),
      etaItem({ stop_id: 'e', sequence_number: 5, arrived: true }),
    ];
    const eta = etaResponse(items, null);
    const derived = deriveTripProgress(stops, eta, null, 0);
    assert.equal(derived.frontier, 5);
    assert.equal(derived.nextStop, null, 'should be null, not random first/middle');
  });

  it('sparse fixes: skipped stops never pin next_stop behind frontier', () => {
    const stops = [
      stop({ id: 'a', sequence_number: 1 }),
      stop({ id: 'b', sequence_number: 2 }),
      stop({ id: 'c', sequence_number: 3 }),
    ];
    // Stop a missed (no arrival), but b arrived
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: false }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: true }),
      etaItem({ stop_id: 'c', sequence_number: 3, arrived: false }),
    ];
    const eta = etaResponse(items, items[2]);
    const derived = deriveTripProgress(stops, eta, null, 0);
    assert.equal(derived.frontier, 2);
    assert.equal(derived.nextStop?.id, 'c', 'missed stop a behind frontier should never be next');
  });

  it('diagnostics explain decision', () => {
    const stops = [stop({ id: 'a', sequence_number: 1 }), stop({ id: 'b', sequence_number: 2 })];
    const items = [
      etaItem({ stop_id: 'a', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 'b', sequence_number: 2, arrived: false }),
    ];
    const eta = etaResponse(items, items[1]);
    const derived = deriveTripProgress(stops, eta, 'b', 0);
    assert.ok(derived.reason.length > 10);
    assert.equal(derived.diagnostics.frontier, 1);
    assert.equal(derived.diagnostics.chosenId, 'b');
    assert.equal(derived.diagnostics.serverNextId, 'b');
  });

  it('simulated trips: GPS jumps, drift, sparse fixes, skipped stops always correct upcoming', () => {
    // Build a route of 5 stops
    const stops = Array.from({ length: 5 }, (_, i) =>
      stop({ id: `s${i + 1}`, sequence_number: i + 1 }),
    );

    // Simulate trip progressing normally: frontier 0→1→2→3→4→5
    let frontier = 0;
    for (let seq = 1; seq <= 5; seq++) {
      const items = stops.map((s, idx) =>
        etaItem({
          stop_id: s.id,
          sequence_number: s.sequence_number,
          arrived: idx < seq,
          distance_meters: idx < seq ? null : (idx - seq + 1) * 100,
        }),
      );
      const next = seq < 5 ? items[seq] : null;
      const eta = etaResponse(items, next);
      const derived = deriveTripProgress(stops, eta, next?.stop_id ?? null, frontier);
      frontier = derived.frontier;
      if (seq < 5) {
        assert.equal(derived.nextStop?.sequence_number, seq + 1, `at seq ${seq} next should be ${seq + 1}`);
      } else {
        assert.equal(derived.nextStop, null, 'at end next should be null');
      }
      // Never backward
      assert.ok(derived.frontier >= seq - 1);
    }

    // GPS jump: suddenly at last stop while frontier was 2
    const jumpItems = [
      etaItem({ stop_id: 's1', sequence_number: 1, arrived: true }),
      etaItem({ stop_id: 's2', sequence_number: 2, arrived: true }),
      etaItem({ stop_id: 's3', sequence_number: 3, arrived: false }),
      etaItem({ stop_id: 's4', sequence_number: 4, arrived: false }),
      etaItem({ stop_id: 's5', sequence_number: 5, arrived: false, distance_meters: 10 }),
    ];
    const jumpEta = etaResponse(jumpItems, jumpItems[4]);
    const afterJump = deriveTripProgress(stops, jumpEta, 's5', 2);
    // Even if server says next is last (s5) which is ahead, it's okay, but it must be ahead, not random middle
    assert.ok(afterJump.nextStop !== null);
    assert.ok((afterJump.nextStop?.sequence_number ?? 0) > 2, 'next must be ahead of frontier after jump');
  });
});
