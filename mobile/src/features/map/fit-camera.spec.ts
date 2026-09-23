import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_MIN_FIT_ZOOM,
  SINGLE_POINT_ZOOM,
  fitZoomForBounds,
  initialCameraFor,
} from './fit-camera.ts';

describe('fit-camera', () => {
  it('floors an automatic fit at MAP_MIN_FIT_ZOOM (13, web parity)', () => {
    // A several-kilometre corridor (~0.5° latitude) computes to ~z9 without
    // the floor — the "unlabeled outline" zoom the tracking map must never
    // open at. The raw span math is inlined here so the test shows the floor
    // is what changes the answer.
    const raw = Math.log2(360 / ((40.9 - 40.4) * 1.4));
    assert.ok(raw < MAP_MIN_FIT_ZOOM, 'raw math must actually request the floor');
    assert.equal(fitZoomForBounds({ north: 40.9, south: 40.4 }), MAP_MIN_FIT_ZOOM);
  });

  it('keeps close-up fits above the floor', () => {
    // ~50 m span: the natural zoom (~z17) is above the floor and stays.
    const zoom = fitZoomForBounds({ north: 40.7003, south: 40.6998 });
    assert.ok(zoom > MAP_MIN_FIT_ZOOM);
  });

  it('frames one point at the single-point zoom', () => {
    const frame = initialCameraFor([{ latitude: 40.7, longitude: -74.0 }]);
    assert.deepEqual(frame, { center: [-74.0, 40.7], zoom: SINGLE_POINT_ZOOM });
  });

  it('centres the bounds and applies the floored zoom for many points', () => {
    const frame = initialCameraFor([
      { latitude: 40.9, longitude: -74.1 },
      { latitude: 40.4, longitude: -73.9 },
    ]);
    assert.ok(frame);
    assert.deepEqual(frame.center, [-74.0, 40.65]);
    assert.equal(frame.zoom, MAP_MIN_FIT_ZOOM);
  });

  it('returns null exactly when there is nothing to frame', () => {
    assert.equal(initialCameraFor([]), null);
  });
});
