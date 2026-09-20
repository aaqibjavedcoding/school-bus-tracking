import { haversineMeters } from '../../lib/geo.ts';
import {
  FOLLOW_CAMERA_MIN_SHIFT_METERS,
  FOLLOW_CAMERA_THROTTLE_MS,
  INITIAL_FOLLOW_CAMERA,
  isZoomGesture,
  reduceFollowCamera,
  type FollowCameraEvent,
  type FollowCameraState,
} from './follow-camera.ts';

/**
 * The follow camera, wired to a map — **without React**.
 *
 * `follow-camera.ts` decides *what the camera should do*; this module does it,
 * against a tiny port. Everything platform-shaped (the MapView ref, the
 * per-frame callback, `AppState`) stays in `useFollowCamera.ts`, and everything
 * else — fit once per trip, pan-never-zoom, throttle, minimum shift, gesture
 * attribution, `isGesture`-less providers, trip switches, foreground resume — is
 * testable with a fake camera and a fake clock.
 *
 * ### Why this is a module and not a hook body
 *
 * It used to live inline in `BusMap.tsx`, which meant a second map (the Driver
 * Trip screen) had no way to reuse it and would have reimplemented the camera —
 * exactly how map integrations end up with two different camera behaviours.
 * The rules below are subtle enough that a copy would drift.
 *
 * ### The rules, and why each one exists
 *
 * 1. **Fit once per trip** (`data-available` → `fit`), never on a GPS update. A
 *    map that re-fits on every fix cannot be read.
 * 2. **Pan by centre only, never zoom.** Whatever the viewer zoomed to is what
 *    they keep.
 * 3. **Throttle pans** to `FOLLOW_CAMERA_THROTTLE_MS` and skip moves below
 *    `FOLLOW_CAMERA_MIN_SHIFT_METERS` — a bus idling at a stop must not vibrate
 *    the camera.
 * 4. **A user gesture ends following**, and only an explicit `recenter` brings
 *    it back. Programmatic moves never fire the gesture signals, so following
 *    cannot knock itself out.
 * 5. **Apple Maps has no `isGesture`**, so a zoom delta we did not cause is the
 *    provider-independent second signal (`isZoomGesture`).
 */

/** A WGS-84 point — the camera policy's own coordinate shape. */
export interface CameraPoint {
  latitude: number;
  longitude: number;
}

export interface EdgePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The only thing this controller needs from a map. The MapLibre `Camera` ref
 * satisfies it (see `useFollowCamera.ts`); a test double satisfies it in ten
 * lines.
 */
export interface FollowCameraPort {
  /** Moves the camera centre (and optionally zoom) over `duration` ms. */
  animateCamera(center: CameraPoint, options: { duration: number; zoom?: number }): void;
  /** Frames every point, padded at the edges. */
  fitToCoordinates(
    points: CameraPoint[],
    options: { edgePadding: EdgePadding; animated: boolean },
  ): void;
}

export interface FollowCameraControllerDeps {
  port: FollowCameraPort;
  /** Monotonic clock in ms. Injected so a spec can drive the throttle. */
  now: () => number;
  /** Called only when the mode actually changes, so React state can follow it. */
  onModeChange?: (mode: FollowCameraState['mode']) => void;
  /** Zoom used when there is exactly one point to frame. */
  singlePointZoom?: number;
  /** Padding that keeps markers off the edge when the route is fitted. */
  edgePadding?: EdgePadding;
}

export interface FollowCameraController {
  /** Route stop coordinates, in order. */
  setRoute(points: CameraPoint[]): void;
  /** The newest real fix — used to frame the map, never to move the camera by itself. */
  setFix(fix: CameraPoint | null): void;
  /** The first moment there is something to frame (idempotent per trip). */
  dataAvailable(): void;
  /** A new fix arrived. */
  fixArrived(): void;
  /** A genuine user pan or zoom. */
  userGesture(): void;
  /** `onRegionChange` — gesture attribution where the provider supplies it. */
  regionChanged(region: { latitudeDelta: number }, details: { isGesture?: boolean }): void;
  /** `onRegionChangeComplete` — attribution, plus the zoom-delta fallback. */
  regionChangeComplete(
    region: { latitude: number; longitude: number; latitudeDelta: number },
    details: { isGesture?: boolean },
  ): void;
  /** The native map is ready; applies a fit that was requested too early. */
  mapReady(): void;
  /** Per-frame position from the marker's animation loop. */
  frame(rendered: CameraPoint | null): void;
  /** App returned to the foreground: reconcile, never replay. */
  resumed(): void;
  /** Another trip: drop the fitted bounds and start following again. */
  tripChanged(): void;
  /** The explicit "Follow bus" control. */
  recenter(): void;
  isFollowing(): boolean;
}

export function createFollowCameraController(
  deps: FollowCameraControllerDeps,
): FollowCameraController {
  const singlePointZoom = deps.singlePointZoom ?? 15;
  const edgePadding = deps.edgePadding ?? { top: 48, right: 48, bottom: 48, left: 48 };

  let camera: FollowCameraState = INITIAL_FOLLOW_CAMERA;
  let routeCoordinates: CameraPoint[] = [];
  let currentFix: CameraPoint | null = null;
  /** Where the marker is on screen right now — what follow mode centres on. */
  let rendered: CameraPoint | null = null;
  /** Where we last put (or observed) the camera centre. */
  let lastCenter: CameraPoint | null = null;
  let lastCameraAt = 0;
  /** `null` means "we changed the zoom ourselves; do not judge the next delta". */
  let expectedDelta: number | null = null;
  let ready = false;
  let pendingFit = false;

  function panTo(center: CameraPoint, duration: number): void {
    lastCenter = { latitude: center.latitude, longitude: center.longitude };
    lastCameraAt = deps.now();
    // Centre only. Zoom is deliberately absent so a GPS update can never change
    // how far the viewer has zoomed — both providers merge a partial camera with
    // the current one (`MKMapCameraWithDefaults:existingCamera:` on iOS,
    // `CameraPosition.Builder(map.getCameraPosition())` on Android).
    deps.port.animateCamera(
      { latitude: center.latitude, longitude: center.longitude },
      { duration },
    );
  }

  /**
   * The one follow-pan path, used by both the frame loop and explicit intents.
   * `force` skips the throttle (the user asked) but never the minimum-shift
   * guard, so an idling bus cannot vibrate the camera.
   */
  function maybeFollowPan(duration: number, force: boolean): void {
    const target = rendered;
    if (!target) return;
    if (!force && deps.now() - lastCameraAt < FOLLOW_CAMERA_THROTTLE_MS) return;
    if (lastCenter && haversineMeters(lastCenter, target) < FOLLOW_CAMERA_MIN_SHIFT_METERS) return;
    // Slightly longer than the throttle so consecutive pans overlap instead of
    // stepping — that overlap is what a smooth trailing camera is.
    panTo(target, duration);
  }

  function fitToData(animated: boolean): void {
    if (!ready) {
      // The map is not ready yet; `mapReady()` will run this fit.
      pendingFit = true;
      return;
    }
    const points: CameraPoint[] = [...routeCoordinates];
    if (currentFix) points.push(currentFix);
    if (points.length === 0) return;

    // We are about to change the zoom ourselves, so the next region report must
    // not be mistaken for a user pinch.
    expectedDelta = null;
    lastCenter = null;
    if (points.length === 1) {
      deps.port.animateCamera(points[0], {
        zoom: singlePointZoom,
        duration: animated ? 500 : 1,
      });
      return;
    }
    deps.port.fitToCoordinates(points, { edgePadding, animated });
  }

  function dispatch(event: FollowCameraEvent): void {
    const previous = camera;
    const next = reduceFollowCamera(previous, event);
    camera = next;
    if (next.mode !== previous.mode) deps.onModeChange?.(next.mode);
    if (next.intent === 'fit') fitToData(false);
    else if (next.intent === 'pan') maybeFollowPan(FOLLOW_CAMERA_THROTTLE_MS, true);
  }

  return {
    setRoute(points) {
      routeCoordinates = points;
    },

    setFix(fix) {
      currentFix = fix;
    },

    dataAvailable() {
      if (routeCoordinates.length > 0 || currentFix) dispatch({ type: 'data-available' });
    },

    fixArrived() {
      if (currentFix) dispatch({ type: 'fix-arrived' });
    },

    userGesture() {
      dispatch({ type: 'user-gesture' });
    },

    regionChanged(_region, details) {
      // The engine reports gesture attribution on the region events (MapLibre
      // sets `userInteraction` on both platforms; the binding maps it to
      // `isGesture`). Reacting to the first event rather than the last means
      // the camera stops fighting the user mid-drag instead of after the drag
      // ends.
      if (details.isGesture === true) dispatch({ type: 'user-gesture' });
    },

    regionChangeComplete(region, details) {
      // A zoom delta we did not cause is the provider-independent second
      // signal (kept for the case where an engine stops reporting gesture
      // attribution — the old Apple-Maps situation). Follow mode only ever
      // pans, so any zoom change is a user's.
      if (details.isGesture === true || isZoomGesture(expectedDelta, region.latitudeDelta)) {
        dispatch({ type: 'user-gesture' });
      }
      expectedDelta = region.latitudeDelta;
      // Track where the camera actually ended up, including after a user
      // gesture — otherwise "recenter" could think it is already there.
      lastCenter = { latitude: region.latitude, longitude: region.longitude };
    },

    mapReady() {
      ready = true;
      if (pendingFit) {
        pendingFit = false;
        fitToData(false);
      }
    },

    frame(next) {
      rendered = next;
      if (camera.mode !== 'following') return;
      maybeFollowPan(FOLLOW_CAMERA_THROTTLE_MS + 50, false);
    },

    resumed() {
      dispatch({ type: 'resumed' });
    },

    tripChanged() {
      rendered = null;
      lastCenter = null;
      expectedDelta = null;
      // The native map is not remounted on a trip switch, so `onMapReady` would
      // never fire again: a fit requested before readiness must survive.
      pendingFit = !ready;
      dispatch({ type: 'trip-changed' });
    },

    recenter() {
      dispatch({ type: 'recenter' });
    },

    isFollowing() {
      return camera.mode === 'following';
    },
  };
}
