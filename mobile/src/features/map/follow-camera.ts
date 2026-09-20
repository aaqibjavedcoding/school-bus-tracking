/**
 * Follow-camera policy — a pure reducer, shared by the native and web maps.
 *
 * The one rule this module exists to enforce: **the camera belongs to the
 * person looking at the map, not to the GPS stream.** Before this, the native
 * map passed a controlled `region` recomputed from `[stops, fix]`, so every
 * incoming fix (~4 s apart) re-fitted the whole route and yanked the map out
 * from under anyone trying to look at a stop.
 *
 * Two intents, deliberately separate:
 *
 * - `fit` — compute bounds over the route's stops *and* the bus, used once per
 *   trip on load and on an explicit recenter-with-fit. Never on a GPS update.
 * - `pan` — move the centre only, preserving zoom, while following. Zoom is
 *   never changed by a GPS update, which is what stops the camera pumping.
 *
 * User gestures are the only thing that leaves follow mode, and they are
 * detected at the platform layer (`onRegionChangeComplete(_, { isGesture })`
 * on native; Leaflet `dragstart` / `zoomstart`, neither of which a programmatic
 * `panTo` fires, on web). A programmatic camera move therefore cannot knock the
 * user out of follow mode.
 */

export type FollowMode =
  /** Camera tracks the bus. */
  | 'following'
  /** The user panned or zoomed; the camera is theirs until they ask for it back. */
  | 'exploring';

/** What the platform layer should do to the camera, if anything. */
export type CameraIntent = 'none' | 'fit' | 'pan';

export interface FollowCameraState {
  mode: FollowMode;
  /** True once the initial bounds have been applied for the current trip. */
  hasFitted: boolean;
  intent: CameraIntent;
}

export type FollowCameraEvent =
  /** Stops and/or the first fix became available — may trigger the initial fit. */
  | { type: 'data-available' }
  /** A genuine user pan or zoom. */
  | { type: 'user-gesture' }
  /** The explicit "Follow bus" / "Recenter" control. */
  | { type: 'recenter' }
  /** A new fix arrived. */
  | { type: 'fix-arrived' }
  /** Another trip was selected: everything about the camera resets. */
  | { type: 'trip-changed' }
  /** App returned to the foreground. */
  | { type: 'resumed' };

export const INITIAL_FOLLOW_CAMERA: FollowCameraState = {
  mode: 'following',
  hasFitted: false,
  intent: 'none',
};

/**
 * How often follow mode may move the camera, in ms.
 *
 * Decoupled from both the fix cadence (~2.5–4 s) and the render frame rate
 * (~20 fps): stepping the camera on every frame makes it vibrate against the
 * marker's own tween, and stepping it once per fix makes it visibly lurch.
 * 500 ms with a matching tween duration reads as a smooth trailing camera.
 */
export const FOLLOW_CAMERA_THROTTLE_MS = 500;

/**
 * Distance (metres) below which follow mode leaves the camera alone.
 *
 * A bus idling at a stop jitters a few metres; re-centering on each of those
 * moves is pure camera noise. 5 m is well inside the size of a stop.
 */
export const FOLLOW_CAMERA_MIN_SHIFT_METERS = 5;

export function reduceFollowCamera(
  state: FollowCameraState,
  event: FollowCameraEvent,
): FollowCameraState {
  switch (event.type) {
    case 'data-available': {
      // The initial fit needs *something* to fit. It fires once per trip, on
      // the first moment stops or a fix exist — never again, so a later fix
      // can never force-fit the route back into frame.
      if (state.hasFitted) return { ...state, intent: 'none' };
      return { mode: 'following', hasFitted: true, intent: 'fit' };
    }

    case 'user-gesture':
      // The user took the camera. Follow mode stops immediately and stays off
      // until they explicitly ask for it back — silently snapping back would be
      // the most annoying thing a tracking map can do.
      return { ...state, mode: 'exploring', intent: 'none' };

    case 'recenter':
      // Explicit: restore follow mode and centre on the bus, keeping the zoom
      // the user chose. Changing zoom here would be a second surprise.
      return { ...state, mode: 'following', hasFitted: true, intent: 'pan' };

    case 'fix-arrived':
      return {
        ...state,
        hasFitted: true,
        intent: state.mode === 'following' ? 'pan' : 'none',
      };

    case 'trip-changed':
      // A different bus on a different route: drop the fitted bounds so the
      // next available data produces a fresh fit, and start following again.
      return { mode: 'following', hasFitted: false, intent: 'none' };

    case 'resumed':
      // Foreground resume reconciles with *current* data: if the user was
      // following, jump to where the bus is now. It never replays the movement
      // that happened while the app was backgrounded.
      if (state.mode !== 'following') return { ...state, intent: 'none' };
      return { ...state, intent: 'pan' };
  }
}

/**
 * Relative zoom change that counts as a user gesture.
 *
 * 2 % is far above the rounding noise of a platform region report and far
 * below one pinch-zoom step, so a genuine zoom is never missed and a reported
 * region that merely wobbles is never mistaken for one. (MapLibre reports
 * gesture attribution on both platforms, so this stays the belt-and-braces
 * half of the detection — sound by construction: see below.)
 */
export const ZOOM_GESTURE_TOLERANCE = 0.02;

/**
 * Detects a user **zoom** on providers that do not report gesture attribution.
 *
 * MapLibre reports `userInteraction` on its region events on both platforms
 * (the binding maps it to `isGesture`), but this fallback is the
 * provider-independent half of gesture detection and stays sound by
 * construction: follow mode only ever *pans*, so any zoom change the map did
 * not just report back to us must have come from the user.
 *
 * `previousDelta` is `null` right after we change zoom ourselves (the initial
 * fit), which means "the next delta is unknown — record it, do not judge it".
 */
export function isZoomGesture(previousDelta: number | null, nextDelta: number): boolean {
  if (previousDelta === null) return false;
  if (!Number.isFinite(previousDelta) || !Number.isFinite(nextDelta)) return false;
  if (previousDelta <= 0 || nextDelta <= 0) return false;
  return Math.abs(nextDelta - previousDelta) / previousDelta > ZOOM_GESTURE_TOLERANCE;
}

/** True when the camera should track the bus. */
export function isFollowing(state: FollowCameraState): boolean {
  return state.mode === 'following';
}
