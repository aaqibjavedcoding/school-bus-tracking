import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createFollowCameraController,
  type CameraPoint,
  type FollowCameraPort,
} from './follow-camera-controller.ts';
import { FOLLOW_CAMERA_THROTTLE_MS } from './follow-camera.ts';

/**
 * The follow-camera *binding*, against a fake camera and a fake clock.
 *
 * `follow-camera.spec.ts` already pins the reducer's decisions. What was never
 * covered — because it lived inside a React component — is the wiring: that a
 * fit happens once per trip and never on a GPS update, that follow pans carry a
 * centre and **no zoom**, that the throttle and the minimum-shift guard are
 * actually consulted, and that the Apple-Maps zoom-delta fallback ends
 * following when the provider reports no gesture attribution.
 *
 * Those are the behaviours that were silently wrong before Session 1 (the
 * controlled `region` re-fit the route every four seconds), so they are worth
 * asserting rather than eyeballing.
 */

interface CameraCall {
  kind: 'animate' | 'fit';
  center?: CameraPoint;
  zoom?: number;
  duration?: number;
  points?: CameraPoint[];
}

function harness(now = 1_000_000) {
  const calls: CameraCall[] = [];
  let clock = now;
  const port: FollowCameraPort = {
    animateCamera(center, options) {
      calls.push({
        kind: 'animate',
        center,
        // Recorded as "absent" vs "present" — a follow pan must not carry zoom.
        zoom: options.zoom,
        duration: options.duration,
      });
    },
    fitToCoordinates(points) {
      calls.push({ kind: 'fit', points });
    },
  };
  const modes: string[] = [];
  const controller = createFollowCameraController({
    port,
    now: () => clock,
    onModeChange: (mode) => modes.push(mode),
  });
  return {
    calls,
    modes,
    controller,
    advance(ms: number) {
      clock += ms;
    },
  };
}

const ROUTE: CameraPoint[] = [
  { latitude: 12.9, longitude: 77.5 },
  { latitude: 12.95, longitude: 77.56 },
];
const AT_ROUTE: CameraPoint = { latitude: 12.9, longitude: 77.5 };
/** ~110 m north of `AT_ROUTE` — comfortably past the 5 m minimum shift. */
const MOVED: CameraPoint = { latitude: 12.901, longitude: 77.5 };
const JITTERED: CameraPoint = { latitude: 12.90102, longitude: 77.5 };
/** ~110 m further along the same road — an unambiguous move. */
const BEYOND: CameraPoint = { latitude: 12.902, longitude: 77.5 };

describe('follow camera controller — framing', () => {
  it('fits the route once per trip, never on a later GPS update', () => {
    const { controller, calls } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.setFix(AT_ROUTE);

    controller.dataAvailable();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'fit');
    // The route *and* the bus: a fit that framed only the stops would leave the
    // marker just outside the padding as soon as it moved.
    assert.deepEqual(calls[0].points, [...ROUTE, AT_ROUTE]);

    // A new fix must never force-fit the route back into view.
    controller.setFix(MOVED);
    controller.dataAvailable();
    assert.equal(calls.length, 1, 'the second data-available was not idempotent');
  });

  it('defers a fit requested before the native map is ready', () => {
    const { controller, calls } = harness();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    assert.equal(calls.length, 0, 'nothing may be framed before onMapReady');

    controller.mapReady();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'fit');
  });

  it('centres on the single point it has, at the caller’s zoom', () => {
    const { controller, calls } = harness();
    controller.mapReady();
    controller.setRoute([AT_ROUTE]);
    controller.dataAvailable();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'animate');
    assert.deepEqual(calls[0].center, AT_ROUTE);
    assert.equal(calls[0].zoom, 15, 'default single-point zoom');
  });
});

describe('follow camera controller — following', () => {
  it('pans by centre only, and never changes zoom', () => {
    const { controller, calls, advance } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    calls.length = 0;

    controller.setFix(AT_ROUTE);
    controller.frame(AT_ROUTE);
    advance(FOLLOW_CAMERA_THROTTLE_MS + 1);
    controller.frame(MOVED);

    const pans = calls.filter((call) => call.kind === 'animate');
    assert.ok(pans.length >= 1, 'follow mode did not pan at all');
    for (const pan of pans) {
      assert.equal(pan.zoom, undefined, 'a follow pan must never carry a zoom');
    }
    assert.deepEqual(pans.at(-1)?.center, MOVED, 'the camera trails the newest position');
  });

  it('throttles pans and leaves the camera alone inside the minimum shift', () => {
    const { controller, calls, advance } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    calls.length = 0;

    controller.frame(MOVED);
    assert.equal(calls.length, 1, 'the first frame pans');

    // A second frame inside the throttle window is dropped.
    advance(FOLLOW_CAMERA_THROTTLE_MS - 1);
    controller.frame(MOVED);
    assert.equal(calls.length, 1);

    // Past the throttle, but a 1 m creep is not a move worth chasing.
    advance(2);
    controller.frame(JITTERED);
    assert.equal(calls.length, 1, 'a sub-5 m move must not move the camera');

    // A real move does pan.
    controller.frame(BEYOND);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.at(-1)?.center, BEYOND);
  });

  it('stops following on a user gesture and only resumes on recenter', () => {
    const { controller, calls, modes, advance } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    calls.length = 0;

    controller.userGesture();
    assert.deepEqual(modes, ['exploring']);

    advance(FOLLOW_CAMERA_THROTTLE_MS * 4);
    controller.frame(MOVED);
    assert.equal(calls.length, 0, 'the user owns the camera now');

    controller.recenter();
    assert.deepEqual(modes, ['exploring', 'following']);
    assert.equal(calls.length, 1, 'recenter pans immediately, without waiting for the throttle');
    assert.equal(calls[0].zoom, undefined, 'recenter keeps the viewer’s zoom');
  });

  it('does not follow after a foreground resume while the user is exploring', () => {
    const { controller, calls } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    controller.setFix(MOVED);
    controller.userGesture();
    calls.length = 0;

    controller.resumed();
    assert.equal(calls.length, 0);
  });

  it('does not pan when the viewer is following but there is no rendered position yet', () => {
    const { controller, calls } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    calls.length = 0;

    controller.frame(null);
    assert.equal(calls.length, 0);
  });
});

describe('follow camera controller — gesture detection', () => {
  it('honours provider gesture attribution', () => {
    const { controller, modes } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();

    controller.regionChanged({ latitudeDelta: 0.02 }, { isGesture: true });
    assert.deepEqual(modes, ['exploring']);
  });

  it('detects a zoom the map did not cause on providers without attribution', () => {
    const { controller, modes } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();

    // The report right after our own fit is not judged — it is recorded.
    controller.regionChangeComplete({ latitude: 12.9, longitude: 77.5, latitudeDelta: 0.02 }, {});
    assert.deepEqual(modes, [], 'our own fit must not read as a user pinch');

    // A wobble inside the tolerance is still not a gesture.
    controller.regionChangeComplete({ latitude: 12.9, longitude: 77.5, latitudeDelta: 0.0201 }, {});
    assert.deepEqual(modes, []);

    // A real pinch is.
    controller.regionChangeComplete({ latitude: 12.9, longitude: 77.5, latitudeDelta: 0.05 }, {});
    assert.deepEqual(modes, ['exploring']);
  });

  it('tracks where the camera actually ended up after a gesture', () => {
    const { controller, calls } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    controller.setFix(MOVED);
    controller.frame(MOVED);
    controller.userGesture();
    // The user panned — the camera is nowhere near the bus.
    controller.regionChangeComplete(
      { latitude: 12.7, longitude: 77.4, latitudeDelta: 0.02 },
      { isGesture: true },
    );
    calls.length = 0;

    controller.recenter();
    assert.equal(
      calls.length,
      1,
      'recenter must move from where the camera is, not from a stale centre',
    );
    assert.deepEqual(calls[0].center, MOVED);
  });
});

describe('follow camera controller — trip lifecycle', () => {
  it('drops the rendered position and re-fits on a trip switch', () => {
    const { controller, calls, advance } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    controller.setFix(MOVED);
    controller.frame(MOVED);
    calls.length = 0;

    controller.tripChanged();
    // The old bus's rendered position must not be panned to.
    advance(FOLLOW_CAMERA_THROTTLE_MS * 2);
    controller.frame(null);
    assert.equal(calls.length, 0);

    // The new trip has no fix yet (the observer hook drops the previous bus's
    // position), so one stop frames by centre + zoom.
    controller.setFix(null);
    controller.setRoute([{ latitude: 13.1, longitude: 77.7 }]);
    controller.dataAvailable();
    assert.equal(calls.length, 1, 'the new route is framed');
    assert.equal(calls[0].kind, 'animate', 'one stop frames by centre + zoom');
  });

  it('re-fits a new trip even though the map was ready long ago', () => {
    const { controller, calls } = harness();
    controller.mapReady();
    controller.setRoute(ROUTE);
    controller.dataAvailable();
    controller.tripChanged();

    controller.setRoute([
      { latitude: 13.1, longitude: 77.7 },
      { latitude: 13.2, longitude: 77.8 },
    ]);
    controller.dataAvailable();
    assert.equal(calls.at(-1)?.kind, 'fit');
  });
});
