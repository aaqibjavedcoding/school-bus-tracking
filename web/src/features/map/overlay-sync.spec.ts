import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCURACY_SOURCE_ID,
  ROUTE_SOURCE_ID,
  TRAIL_SOURCE_ID,
  createOverlaySync,
  type OverlayData,
  type OverlayStop,
  type StopMarkerKind,
} from './overlay-sync.ts';

/**
 * The ordering bug, pinned.
 *
 * The web map lost its bus marker to a pure wiring fault: the map was built
 * by an effect gated on an async WebGL2 check, the marker was written by an
 * effect gated on `fix`, and the marker effect listed nothing about the map
 * in its dependency array. A trip whose only position came from the REST
 * snapshot therefore rendered forever without a bus.
 *
 * These tests drive `overlay-sync.ts` with a **fake map**, so the rule —
 * "whichever of the map and the data arrives last does the write" — is
 * checked without a browser, a canvas or MapLibre.
 */

interface FakeSource {
  id: string;
  data: unknown;
}

interface FakeMap {
  name: string;
  sources: Map<string, FakeSource>;
}

interface FakeMarker {
  kind: 'bus' | 'stop';
  map: string;
  lngLat: [number, number];
  removed: boolean;
  stopId?: string;
  stopKind?: StopMarkerKind;
  label?: string;
}

function makeFakeMap(name = 'map-1', withSources = true): FakeMap {
  const sources = new Map<string, FakeSource>();
  if (withSources) {
    for (const id of [ROUTE_SOURCE_ID, TRAIL_SOURCE_ID, ACCURACY_SOURCE_ID]) {
      sources.set(id, { id, data: null });
    }
  }
  return { name, sources };
}

function makeHarness() {
  const markers: FakeMarker[] = [];
  const sync = createOverlaySync<FakeMap, FakeMarker, FakeMarker>({
    getSource: (map, id) => {
      const source = map.sources.get(id);
      if (source === undefined) return null;
      return {
        setData: (data) => {
          source.data = data;
        },
      };
    },
    createBusMarker: (map, lngLat) => {
      const marker: FakeMarker = { kind: 'bus', map: map.name, lngLat, removed: false };
      markers.push(marker);
      return marker;
    },
    moveBusMarker: (marker, lngLat) => {
      marker.lngLat = lngLat;
    },
    removeBusMarker: (marker) => {
      marker.removed = true;
    },
    createStopMarker: (map, stop, kind) => {
      const marker: FakeMarker = {
        kind: 'stop',
        map: map.name,
        lngLat: [stop.longitude, stop.latitude],
        removed: false,
        stopId: stop.id,
        stopKind: kind,
        label: `${stop.sequence_number}. ${stop.name}`,
      };
      markers.push(marker);
      return marker;
    },
    updateStopMarker: (marker, stop, kind) => {
      marker.lngLat = [stop.longitude, stop.latitude];
      marker.stopKind = kind;
      marker.label = `${stop.sequence_number}. ${stop.name}`;
    },
    removeStopMarker: (marker) => {
      marker.removed = true;
    },
  });

  const busMarkers = () => markers.filter((m) => m.kind === 'bus' && !m.removed);
  const stopMarkers = () => markers.filter((m) => m.kind === 'stop' && !m.removed);
  return { sync, markers, busMarkers, stopMarkers };
}

const stop = (id: string, sequence: number, lat: number, lng: number): OverlayStop => ({
  id,
  sequence_number: sequence,
  name: `Stop ${sequence}`,
  latitude: lat,
  longitude: lng,
});

const data = (overrides: Partial<OverlayData> = {}): OverlayData => ({
  fix: null,
  routeCoordinates: [],
  trailCoordinates: [],
  accuracyFeature: null,
  stops: [],
  highlightStopId: null,
  nextStopId: null,
  ...overrides,
});

const WITH_FIX = data({ fix: { latitude: 19.07, longitude: 72.87 } });

describe('the regression: a map created AFTER the first fix', () => {
  it('still ends up with a bus marker', () => {
    const { sync, busMarkers } = makeHarness();

    // 1. The REST snapshot resolves first. There is no map yet (the WebGL
    //    check has not come back), so nothing can be written.
    const beforeMap = sync.sync({ map: null, ready: false, data: WITH_FIX });
    assert.equal(beforeMap.applied, false, 'nothing may be written without a map');
    assert.equal(busMarkers().length, 0);

    // 2. The map is created and fires `load`. The fix has not changed — this
    //    is exactly the moment the old code never reacted to.
    const map = makeFakeMap();
    const afterLoad = sync.sync({ map, ready: true, data: WITH_FIX });

    assert.equal(afterLoad.applied, true);
    assert.equal(afterLoad.busMarkerCreated, true, 'the bus must appear on the first ready sync');
    assert.equal(busMarkers().length, 1);
    assert.deepEqual(busMarkers()[0].lngLat, [72.87, 19.07]);
    assert.equal(sync.hasBusMarker(), true);
  });

  it('frames the bus exactly once — the second sync must not recreate it', () => {
    const { sync, busMarkers, markers } = makeHarness();
    const map = makeFakeMap();

    const first = sync.sync({ map, ready: true, data: WITH_FIX });
    const second = sync.sync({ map, ready: true, data: WITH_FIX });

    assert.equal(first.busMarkerCreated, true);
    assert.equal(second.busMarkerCreated, false, 'the camera may only be handed one "fit"');
    assert.equal(busMarkers().length, 1);
    assert.equal(markers.filter((m) => m.kind === 'bus').length, 1);
  });

  it('a not-yet-loaded map is as good as no map (the style owns the sources)', () => {
    const { sync, busMarkers } = makeHarness();
    const map = makeFakeMap();

    const result = sync.sync({ map, ready: false, data: WITH_FIX });

    assert.equal(result.applied, false);
    assert.equal(busMarkers().length, 0, 'adding a marker before `load` is how markers get lost');
  });

  it('loses nothing when the data changed while the map was missing', () => {
    const { sync, busMarkers, stopMarkers } = makeHarness();

    sync.sync({ map: null, ready: false, data: WITH_FIX });
    const latest = data({
      fix: { latitude: 19.2, longitude: 72.9 },
      stops: [stop('a', 1, 19.1, 72.8)],
      routeCoordinates: [
        [72.8, 19.1],
        [72.9, 19.2],
      ],
    });

    const map = makeFakeMap();
    sync.sync({ map, ready: true, data: latest });

    // The writer holds no queue on purpose: the caller always passes current
    // data, so the first ready sync is the whole truth.
    assert.deepEqual(busMarkers()[0].lngLat, [72.9, 19.2]);
    assert.equal(stopMarkers().length, 1);
    assert.deepEqual((map.sources.get(ROUTE_SOURCE_ID)!.data as { geometry: { coordinates: number[][] } }).geometry.coordinates, [
      [72.8, 19.1],
      [72.9, 19.2],
    ]);
  });
});

describe('sources', () => {
  it('writes route, trail and accuracy on every applied sync', () => {
    const { sync } = makeHarness();
    const map = makeFakeMap();

    const result = sync.sync({
      map,
      ready: true,
      data: data({
        routeCoordinates: [
          [72.8, 19.1],
          [72.9, 19.2],
        ],
        trailCoordinates: [
          [72.81, 19.11],
          [72.82, 19.12],
        ],
        accuracyFeature: { type: 'Feature', properties: {}, geometry: null },
      }),
    });

    assert.deepEqual([...result.sourcesUpdated].sort(), [
      ACCURACY_SOURCE_ID,
      ROUTE_SOURCE_ID,
      TRAIL_SOURCE_ID,
    ].sort());
    const accuracy = map.sources.get(ACCURACY_SOURCE_ID)!.data as { features: unknown[] };
    assert.equal(accuracy.features.length, 1);
  });

  it('never draws a one-point "line"', () => {
    const { sync } = makeHarness();
    const map = makeFakeMap();

    sync.sync({ map, ready: true, data: data({ routeCoordinates: [[72.8, 19.1]] }) });

    const route = map.sources.get(ROUTE_SOURCE_ID)!.data as {
      geometry: { coordinates: number[][] };
    };
    assert.deepEqual(route.geometry.coordinates, []);
  });

  it('skips a source that does not exist yet instead of throwing', () => {
    const { sync, busMarkers } = makeHarness();
    const map = makeFakeMap('map-1', false);

    const result = sync.sync({ map, ready: true, data: WITH_FIX });

    assert.deepEqual(result.sourcesUpdated, []);
    assert.equal(busMarkers().length, 1, 'a missing source must not block the markers');
  });
});

describe('stop markers', () => {
  const three = [stop('a', 1, 19.1, 72.8), stop('b', 2, 19.2, 72.9), stop('c', 3, 19.3, 72.95)];

  it('creates one marker per stop and diffs by id afterwards', () => {
    const { sync, stopMarkers } = makeHarness();
    const map = makeFakeMap();

    const first = sync.sync({ map, ready: true, data: data({ stops: three }) });
    assert.equal(first.stopMarkersCreated, 3);

    const second = sync.sync({ map, ready: true, data: data({ stops: three.slice(0, 2) }) });
    assert.equal(second.stopMarkersCreated, 0, 'existing markers are reused, never recreated');
    assert.equal(second.stopMarkersRemoved, 1);
    assert.deepEqual(
      stopMarkers().map((m) => m.stopId),
      ['a', 'b'],
    );
  });

  it('changes only the kind when the highlight moves', () => {
    const { sync, stopMarkers, markers } = makeHarness();
    const map = makeFakeMap();

    sync.sync({ map, ready: true, data: data({ stops: three, nextStopId: 'b' }) });
    const created = markers.length;
    sync.sync({ map, ready: true, data: data({ stops: three, nextStopId: 'c', highlightStopId: 'a' }) });

    assert.equal(markers.length, created, 'a highlight change must not recreate any marker');
    assert.deepEqual(
      stopMarkers().map((m) => m.stopKind),
      ['current', 'plain', 'next'],
    );
  });
});

describe('the bus marker lifecycle', () => {
  it('follows the fix without recreating the marker', () => {
    const { sync, busMarkers, markers } = makeHarness();
    const map = makeFakeMap();

    sync.sync({ map, ready: true, data: WITH_FIX });
    sync.sync({ map, ready: true, data: data({ fix: { latitude: 19.08, longitude: 72.88 } }) });

    assert.equal(markers.filter((m) => m.kind === 'bus').length, 1);
    assert.deepEqual(busMarkers()[0].lngLat, [72.88, 19.08]);
  });

  it('removes the bus when the fix disappears, and re-creates it when it returns', () => {
    const { sync, busMarkers } = makeHarness();
    const map = makeFakeMap();

    sync.sync({ map, ready: true, data: WITH_FIX });
    sync.sync({ map, ready: true, data: data({ fix: null }) });
    assert.equal(busMarkers().length, 0);
    assert.equal(sync.hasBusMarker(), false);

    const again = sync.sync({ map, ready: true, data: WITH_FIX });
    assert.equal(again.busMarkerCreated, true, 'the camera gets to frame the bus again');
    assert.equal(busMarkers().length, 1);
  });

  it('drops handles from a previous map instead of reusing dead references', () => {
    const { sync, markers } = makeHarness();

    sync.sync({ map: makeFakeMap('map-1'), ready: true, data: WITH_FIX });
    const replacement = makeFakeMap('map-2');
    const result = sync.sync({ map: replacement, ready: true, data: WITH_FIX });

    // The old marker is not "removed" — the engine tore it down with its map,
    // which is exactly why holding the handle would be a dead reference.
    assert.equal(result.busMarkerCreated, true, 'a new map needs a new marker');
    const buses = markers.filter((m) => m.kind === 'bus');
    assert.equal(buses.length, 2);
    assert.equal(buses[1].map, 'map-2');
    assert.equal(sync.hasBusMarker(), true);
  });

  it('forgets everything on reset (the engine removed the markers with the map)', () => {
    const { sync } = makeHarness();
    const map = makeFakeMap();

    sync.sync({ map, ready: true, data: data({ ...WITH_FIX, stops: [stop('a', 1, 19.1, 72.8)] }) });
    assert.equal(sync.hasBusMarker(), true);
    assert.equal(sync.stopMarkerCount(), 1);

    sync.reset();

    assert.equal(sync.hasBusMarker(), false);
    assert.equal(sync.stopMarkerCount(), 0);
  });
});
