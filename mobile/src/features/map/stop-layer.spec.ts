import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { STOP_LAYER_RADIUS_PX, stopsLayerCollection, type StopLayerStop } from './stop-layer.ts';

/**
 * The one-layer stops, pinned:
 *
 * - ONE FeatureCollection for N stops — the source is set once, never per
 *   stop (a 30-stop route is one upload, not thirty annotations);
 * - every feature is located, ordered as given, and carries the label the
 *   caller localised;
 * - `kind` is `driverStopMarkerKind`'s verdict — only the screen's next-stop
 *   id can make a stop 'next', and an unknown id makes nothing next;
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
    address: null,
    geofence_radius_meters: 100,
    effective_radius_meters: 100,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as StopResponse as StopLayerStop;
}

const labelFor = (entry: StopLayerStop, kind: 'plain' | 'next'): string =>
  kind === 'next'
    ? `NEXT · ${entry.sequence_number}. ${entry.name}`
    : `${entry.sequence_number}. ${entry.name}`;

describe('stopsLayerCollection', () => {
  it('builds one collection with one feature per located stop', () => {
    const stops = [
      stop('s1', 1, 19.05, 72.85),
      stop('s2', 2, 19.06, 72.86),
      stop('s3', 3, 19.07, 72.87),
    ];
    const collection = stopsLayerCollection(stops, null, labelFor);
    assert.ok(collection);
    assert.equal(collection.type, 'FeatureCollection');
    assert.equal(collection.features.length, 3);
    assert.deepEqual(
      collection.features.map((feature) => feature.geometry.coordinates),
      [
        [72.85, 19.05],
        [72.86, 19.06],
        [72.87, 19.07],
      ],
    );
  });

  it('marks exactly the next stop, and only when its id is on the route', () => {
    const stops = [stop('s1', 1, 19.05, 72.85), stop('s2', 2, 19.06, 72.86)];
    const collection = stopsLayerCollection(stops, 's2', labelFor);
    assert.ok(collection);
    assert.deepEqual(
      collection.features.map((feature) => feature.properties?.kind),
      ['plain', 'next'],
    );
    assert.equal(collection.features[1].properties?.label, 'NEXT · 2. Stop 2');

    const none = stopsLayerCollection(stops, 'not-a-stop', labelFor);
    assert.ok(none);
    assert.deepEqual(
      none.features.map((feature) => feature.properties?.kind),
      ['plain', 'plain'],
    );
  });

  it('carries identity and sequence for diagnostics and hit-testing', () => {
    const collection = stopsLayerCollection([stop('s9', 9, 19.05, 72.85)], null, labelFor);
    assert.ok(collection);
    assert.deepEqual(collection.features[0].properties, {
      id: 's9',
      label: '9. Stop 9',
      kind: 'plain',
      sequence: 9,
    });
  });

  it('returns null with no stops — never an empty collection', () => {
    assert.equal(stopsLayerCollection([], null, labelFor), null);
    assert.equal(stopsLayerCollection([], 's1', labelFor), null);
  });

  it('keeps the next-stop dot visibly larger than a plain one', () => {
    assert.ok(STOP_LAYER_RADIUS_PX.next > STOP_LAYER_RADIUS_PX.plain * 1.5);
  });
});
