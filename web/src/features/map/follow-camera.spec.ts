import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FOLLOW_CAMERA_MIN_SHIFT_METERS,
  FOLLOW_CAMERA_THROTTLE_MS,
  INITIAL_FOLLOW_CAMERA,
  ZOOM_GESTURE_TOLERANCE,
  isFollowing,
  isZoomGesture,
  reduceFollowCamera,
  type FollowCameraState,
} from './follow-camera.ts';

/**
 * Follow-camera policy.
 *
 * The regression this pins: the native map used to pass a controlled `region`
 * recomputed from `[stops, fix]`, so every fix re-fitted the route and a user
 * could not look at a stop for longer than ~4 s. Every case below is about who
 * owns the camera.
 */

describe('follow camera: initial fit', () => {
  it('starts in follow mode with nothing fitted', () => {
    assert.deepEqual(INITIAL_FOLLOW_CAMERA, {
      mode: 'following',
      hasFitted: false,
      intent: 'none',
    });
  });

  it('fits once when data first becomes available', () => {
    const next = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'data-available' });
    assert.deepEqual(next, { mode: 'following', hasFitted: true, intent: 'fit' });
  });

  it('never force-fits again on a later GPS update', () => {
    const fitted = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'data-available' });
    for (let i = 0; i < 5; i += 1) {
      const next = reduceFollowCamera(fitted, { type: 'fix-arrived' });
      assert.equal(next.intent, 'pan', `update ${i} must pan, not fit`);
      assert.notEqual(next.intent, 'fit');
    }
    assert.equal(reduceFollowCamera(fitted, { type: 'data-available' }).intent, 'none');
  });
});

describe('follow camera: manual exploration', () => {
  it('a user gesture suspends follow mode', () => {
    const exploring = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'user-gesture' });
    assert.equal(exploring.mode, 'exploring');
    assert.equal(isFollowing(exploring), false);
    assert.equal(exploring.intent, 'none');
  });

  it('stays suspended across many GPS updates', () => {
    let state: FollowCameraState = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, {
      type: 'user-gesture',
    });
    for (let i = 0; i < 10; i += 1) {
      state = reduceFollowCamera(state, { type: 'fix-arrived' });
      assert.equal(state.mode, 'exploring', `update ${i} silently stole the camera back`);
      assert.equal(state.intent, 'none', 'the camera must not move while exploring');
    }
  });

  it('does not move the camera while exploring, even on resume', () => {
    const exploring = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'user-gesture' });
    assert.equal(reduceFollowCamera(exploring, { type: 'resumed' }).intent, 'none');
  });
});

describe('follow camera: explicit recenter', () => {
  it('restores follow mode and pans without changing zoom', () => {
    const exploring = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'user-gesture' });
    const recentered = reduceFollowCamera(exploring, { type: 'recenter' });
    assert.equal(recentered.mode, 'following');
    assert.equal(recentered.intent, 'pan', 'recenter pans; it does not re-fit and re-zoom');
    assert.equal(recentered.hasFitted, true);
  });

  it('subsequent fixes track the bus again after a recenter', () => {
    let state: FollowCameraState = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, {
      type: 'user-gesture',
    });
    state = reduceFollowCamera(state, { type: 'recenter' });
    assert.equal(reduceFollowCamera(state, { type: 'fix-arrived' }).intent, 'pan');
  });

  it('recenter works from follow mode too (idempotent)', () => {
    const fitted = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'data-available' });
    const again = reduceFollowCamera(fitted, { type: 'recenter' });
    assert.equal(again.mode, 'following');
    assert.equal(again.intent, 'pan');
  });
});

describe('follow camera: trip switch', () => {
  it('resets to follow mode with the fit dropped, so the new route is framed', () => {
    const exploring = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'user-gesture' });
    const switched = reduceFollowCamera(exploring, { type: 'trip-changed' });
    assert.deepEqual(switched, { mode: 'following', hasFitted: false, intent: 'none' });
  });

  it('the new trip refits on its first data', () => {
    let state: FollowCameraState = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, {
      type: 'trip-changed',
    });
    state = reduceFollowCamera(state, { type: 'data-available' });
    assert.equal(state.intent, 'fit');
  });

  it('does not leave a stale fit flag that would frame the old route', () => {
    let state: FollowCameraState = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, {
      type: 'data-available',
    });
    assert.equal(state.hasFitted, true);
    state = reduceFollowCamera(state, { type: 'trip-changed' });
    assert.equal(state.hasFitted, false);
  });
});

describe('follow camera: foreground resume', () => {
  it('reconciles with current data while following', () => {
    const fitted = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'data-available' });
    const resumed = reduceFollowCamera(fitted, { type: 'resumed' });
    assert.equal(resumed.mode, 'following');
    assert.equal(resumed.intent, 'pan', 'jumps to the bus as it is now');
  });

  it('does not replay missed movement: resume pans, it never fits', () => {
    const fitted = reduceFollowCamera(INITIAL_FOLLOW_CAMERA, { type: 'data-available' });
    assert.notEqual(reduceFollowCamera(fitted, { type: 'resumed' }).intent, 'fit');
  });
});

describe('follow camera: documented constants', () => {
  it('throttles camera steps away from both the fix cadence and the frame rate', () => {
    assert.equal(FOLLOW_CAMERA_THROTTLE_MS, 500);
    assert.ok(FOLLOW_CAMERA_THROTTLE_MS < 2_500, 'faster than the server throttle floor');
  });

  it('ignores sub-stop-size shifts so an idling bus does not vibrate the camera', () => {
    assert.equal(FOLLOW_CAMERA_MIN_SHIFT_METERS, 5);
  });
});

describe('follow camera: zoom-gesture detection', () => {
  it('flags a real pinch or wheel zoom', () => {
    assert.equal(isZoomGesture(0.02, 0.01), true);
    assert.equal(isZoomGesture(0.02, 0.04), true);
    assert.equal(isZoomGesture(0.02, 0.0195), true);
  });

  it('ignores platform region wobble below the tolerance', () => {
    assert.equal(isZoomGesture(0.02, 0.02), false);
    assert.equal(isZoomGesture(0.02, 0.0202), false);
    assert.equal(isZoomGesture(0.02, 0.0198), false);
  });

  it('never judges the delta right after we changed zoom ourselves', () => {
    assert.equal(isZoomGesture(null, 0.5), false, 'the initial fit is ours, not a gesture');
  });

  it('is defensive about unusable deltas rather than throwing', () => {
    assert.equal(isZoomGesture(Number.NaN, 0.02), false);
    assert.equal(isZoomGesture(0.02, Number.NaN), false);
    assert.equal(isZoomGesture(0, 0.02), false);
    assert.equal(isZoomGesture(0.02, 0), false);
    assert.equal(isZoomGesture(-0.02, 0.02), false);
  });

  it('documents a tolerance above report noise and below one zoom step', () => {
    assert.ok(ZOOM_GESTURE_TOLERANCE > 0.001);
    assert.ok(ZOOM_GESTURE_TOLERANCE < 0.1);
  });
});
