import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { stopLayerKind, stopsLayerCollection, type StopLayerStop } from './stop-layer.ts';

/**
 * The one-layer stops (web), pinned:
 *
 * - ONE FeatureCollection for N stops — the source is set once, never per
 *   stop (a 30-stop route is one upload, not thirty DOM markers);
 * - `highlightStopId` (the parent's home stop) wins over `nextStopId` when
 *   both name the same stop, and the two never fight over a stop;
 * - `null` (never an empty collection) when there is nothing to draw.
 */

function stop(
  id: string,
  sequenceNumber: number,
  latitude: number,
  longitude: number,
): StopLayerStop {
  return {
    id,
    school_id: 'school-1',
    route_id: 'route-1',
    name: `Stop ${sequenceNumber}`,
    sequence_number: sequenceNumber,
    latitude,
    longitude,
    address: '12 Depot Road',
    geofence_radius_meters: 100,
    effective_radius_meters: 100,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as StopResponse as StopLayerStop;
}

describe('stopLayerKind', () => {
  it('prefers the highlighted (current) stop when both props name it', () => {
    assert.equal(stopLayerKind('s1', 's1', 's1'), 'current');
    assert.equal(stopLayerKind('s1', 's1', null), 'current');
    assert.equal(stopLayerKind('s1', null, 's1'), 'next');
    assert.equal(stopLayerKind('s1', 's2', 's2'), 'plain');
    assert.equal(stopLayerKind('s1', null, null), 'plain');
  });
});

describe('stopsLayerCollection', () => {
  it('builds one collection with one feature per located stop', () => {
    const collection = stopsLayerCollection(
      [stop('s1', 1, 19.05, 72.85), stop('s2', 2, 19.06, 72.86)],
      null,
      's2',
    );
    assert.ok(collection);
    assert.equal(collection.type, 'FeatureCollection');
    assert.equal(collection.features.length, 2);
    assert.deepEqual(
      collection.features.map((feature) => feature.properties?.kind),
      ['plain', 'next'],
    );
    assert.equal(collection.features[1].properties?.label, '2. Stop 2');
    assert.equal(collection.features[1].properties?.address, '12 Depot Road');
  });

  it('returns null with no stops — never an empty collection', () => {
    assert.equal(stopsLayerCollection([], null, null), null);
  });
});
