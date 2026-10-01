import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { canSyncOverlays, syncBusMarker, type MarkerLike } from './map-overlays.ts';

/**
 * Regression cover for the P0 "the bus never appears on the web map" defect.
 *
 * The production ordering that produced it, verbatim:
 *
 *   1. first render — the WebGL support probe has not resolved, so no map;
 *   2. the REST snapshot resolves and sets `fix`; the bus-marker effect runs,
 *      finds no map and returns;
 *   3. the WebGL probe resolves, a re-render happens, the map is created;
 *   4. `fix` never changed, so the marker effect never ran again.
 *
 * These tests drive a *fake* map through that exact order and assert the bus
 * ends up on it anyway.
 */

interface FakeMarker extends MarkerLike {
  id: string;
  lngLat: [number, number];
  removed: boolean;
}

class FakeMap {
  public readonly markers: FakeMarker[] = [];

  addMarker(lngLat: [number, number]): FakeMarker {
    const marker: FakeMarker = {
      id: `marker-${this.markers.length}`,
      lngLat,
      removed: false,
      remove: () => {
        marker.removed = true;
      },
    };
    this.markers.push(marker);
    return marker;
  }

  get liveMarkers(): FakeMarker[] {
    return this.markers.filter((m) => !m.removed);
  }
}

const FIX = { latitude: 19.076, longitude: 72.8777 };

function attach(map: FakeMap, lngLat: [number, number]): FakeMarker {
  return map.addMarker(lngLat);
}

describe('syncBusMarker', () => {
  it('still ends up with a bus marker when the map is created AFTER the first fix', () => {
    // Step 2: the fix arrives while there is no map at all.
    let marker: FakeMarker | null = null;
    let outcome = syncBusMarker<FakeMap, FakeMarker>({
      map: null,
      ready: false,
      position: FIX,
      marker,
      createMarker: attach,
    });
    marker = outcome.marker;

    assert.equal(outcome.action, 'deferred');
    assert.equal(marker, null);

    // Step 3: the map is constructed but its style has not loaded yet.
    const map = new FakeMap();
    outcome = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: false,
      position: FIX,
      marker,
      createMarker: attach,
    });
    marker = outcome.marker;

    assert.equal(outcome.action, 'deferred');
    assert.equal(map.liveMarkers.length, 0, 'nothing may be attached before load');

    // Step 4: `load` fires. This is the re-run that the old dependency array
    // ([fix, ...]) never produced — `mapReady` is what schedules it now.
    outcome = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: FIX,
      marker,
      createMarker: attach,
    });
    marker = outcome.marker;

    assert.equal(outcome.action, 'created');
    assert.equal(map.liveMarkers.length, 1);
    assert.deepEqual(map.liveMarkers[0].lngLat, [FIX.longitude, FIX.latitude]);
  });

  it('reports "created" exactly once so the initial camera fit fires once', () => {
    const map = new FakeMap();
    const first = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: FIX,
      marker: null,
      createMarker: attach,
    });
    const second = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: { latitude: 19.08, longitude: 72.88 },
      marker: first.marker,
      createMarker: attach,
    });

    assert.equal(first.action, 'created');
    assert.equal(second.action, 'kept');
    assert.equal(second.marker, first.marker);
    assert.equal(map.markers.length, 1, 'the marker is never recreated for a new fix');
  });

  it('keeps the marker while the map is being rebuilt rather than treating it as "bus gone"', () => {
    const map = new FakeMap();
    const created = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: FIX,
      marker: null,
      createMarker: attach,
    });

    // Style reload / remount: ready flips false with the fix unchanged.
    const during = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: false,
      position: FIX,
      marker: created.marker,
      createMarker: attach,
    });

    assert.equal(during.action, 'deferred');
    assert.equal(during.marker, created.marker);
    assert.equal(created.marker?.removed, false);
  });

  it('removes the marker when the fix genuinely disappears', () => {
    const map = new FakeMap();
    const created = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: FIX,
      marker: null,
      createMarker: attach,
    });

    const removed = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: null,
      marker: created.marker,
      createMarker: attach,
    });

    assert.equal(removed.action, 'removed');
    assert.equal(removed.marker, null);
    assert.equal(created.marker?.removed, true);
    assert.equal(map.liveMarkers.length, 0);
  });

  it('removes a stale marker even if the map has already gone away', () => {
    const map = new FakeMap();
    const created = syncBusMarker<FakeMap, FakeMarker>({
      map,
      ready: true,
      position: FIX,
      marker: null,
      createMarker: attach,
    });

    const removed = syncBusMarker<FakeMap, FakeMarker>({
      map: null,
      ready: false,
      position: null,
      marker: created.marker,
      createMarker: attach,
    });

    assert.equal(removed.action, 'removed');
    assert.equal(created.marker?.removed, true);
  });
});

describe('canSyncOverlays', () => {
  it('requires both a map object and a loaded style', () => {
    assert.equal(canSyncOverlays(null, false), false);
    assert.equal(canSyncOverlays(null, true), false, 'no map, however ready we think we are');
    assert.equal(canSyncOverlays({}, false), false, 'a map whose style has not loaded');
    assert.equal(canSyncOverlays({}, true), true);
  });
});

/**
 * "A fix exists, so there is a bus on the map" — the visibility contract.
 *
 * The two ways a marker can vanish are both bugs unless the UI says what
 * happened: freshness must never remove it (a last-known position is drawn
 * desaturated and frozen — see `bus-marker-icon.spec.ts`), and a map that is
 * merely rebuilding must never remove it either. The only legitimate removal
 * is "there is no position at all", which the map replaces with its stated
 * empty state.
 */
describe('the bus marker never silently disappears', () => {
  const source = readFileSync(`${process.cwd()}/src/features/map/MapViewInner.tsx`, 'utf8');

  it('keeps the marker across a stale → live → stale freshness cycle', () => {
    const map = new FakeMap();
    let marker: FakeMarker | null = null;
    // The position keeps arriving; only its freshness changes, and freshness
    // is not an input here — which is the point.
    for (const position of [FIX, { latitude: 19.0771, longitude: 72.8779 }, FIX]) {
      const outcome = syncBusMarker<FakeMap, FakeMarker>({
        map,
        ready: true,
        position,
        marker,
        createMarker: attach,
      });
      marker = outcome.marker;
      assert.notEqual(outcome.action, 'removed');
    }
    assert.equal(map.liveMarkers.length, 1, 'one bus, still on the map');
    assert.equal(marker?.removed, false);
  });

  it('derives the marker position from the fix alone — never from freshness', () => {
    const call = source.slice(
      source.indexOf('reconcileBusMarker({'),
      source.indexOf('busMarkerRef.current = outcomeMarker.marker'),
    );
    assert.ok(call.length > 0, 'the reconcile call was not found');
    assert.match(
      call,
      /position: fix \? \{ latitude: fix\.latitude, longitude: fix\.longitude \} : null,/,
      'a fix — of any age — is a position to draw',
    );
    assert.doesNotMatch(
      call,
      /presentation|animate|stale|lastKnown/,
      'staleness styles the marker; it must never decide whether one exists',
    );
  });

  it('replaces the bus only with a stated empty state, never with a blank map', () => {
    assert.match(
      source,
      /No GPS position or mapped stops for this trip yet\./,
      'the no-data case is spelled out to the user',
    );
    const emptyOverlay = source.indexOf('map-empty-overlay');
    assert.ok(emptyOverlay !== -1, 'and it is rendered as an overlay on the map shell');
    assert.match(source.slice(0, emptyOverlay), /!hasAnything \? \(/, 'gated on having no data');
  });
});
