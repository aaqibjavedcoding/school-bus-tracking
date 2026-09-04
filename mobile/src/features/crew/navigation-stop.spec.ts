import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { navigationTargetOf, pickNextStop } from './navigation-stop.ts';

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
