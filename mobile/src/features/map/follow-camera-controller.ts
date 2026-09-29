import { haversineMeters } from '../../lib/geo.ts';
import { zoomLimits, zoomStepTarget, type ZoomDirection, type ZoomLimits } from './map-controls.ts';
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
 *    it back. A camera move *we* issued must never be read as one — see the
 *    self-move rule below, which is what makes this true in practice.
 * 5. **Apple Maps has no `isGesture`**, so a zoom delta we did not cause is the
 *    provider-independent second signal (`isZoomGesture`).
 * 6. **A zoom *button* is not a gesture.** `zoomBy` is the on-map +/− control
 *    (`map-controls.ts`): it changes the zoom through the same port, but it is
 *    a camera command the app issued, so it must not end following. The
 *    zoom-delta fallback is silenced for that one report by clearing
 *    `expectedDelta`, exactly as the initial fit already does.
 *
 * ### The self-move rule, and the Android bug that made it necessary
 *
 * Rule 4 used to rest on "programmatic moves never fire the gesture signals".
 * That is true on iOS — `MLRNMapView.m` computes
 * `isUserInteraction = reason & ~MLNCameraChangeReasonProgrammatic`, so an
 * app-issued stop reports `userInteraction: false`. It is **not** true on
 * Android in the installed `@maplibre/maplibre-react-native` (11.4.0):
 *
 * ```kotlin
 * // android/.../mapview/helpers/CameraChangeTracker.kt
 * val isUserInteraction: Boolean
 *     get() = reason == USER_GESTURE || reason == DEVELOPER_ANIMATION
 * ```
 *
 * `DEVELOPER_ANIMATION` is the reason MapLibre's `Transform` reports for
 * `moveCamera` / `easeCamera` / `animateCamera` — i.e. for *our own*
 * `easeTo`, `zoomTo` and `fitBounds`. So on Android every follow pan reported
 * itself back as a user gesture and follow mode switched itself off after the
 * first pan: the "Follow bus does nothing / follow is broken" field report.
 * The zoom-delta fallback could not catch it either, because a follow pan
 * changes no zoom.
 *
 * The fix is provider-independent and stays inside this module: a camera
 * command opens a short **self-move window**, and while it is open a region
 * report whose centre is where we asked the camera to go is *ours*, not the
 * driver's. A report from outside that radius is a real gesture and ends
 * following immediately, even mid-animation — which is exactly what a driver
 * dragging the map while the camera is trailing the bus must produce.
 */

/**
 * How long a zoom-button step takes.
 *
 * Short enough to feel like a button (a 500 ms `flyTo` reads as the map
 * deciding something), long enough not to jump: the same 250 ms the marker's
 * own tween uses between frames.
 */
export const MAP_ZOOM_BUTTON_DURATION_MS = 250;

/**
 * Extra time a self-move window stays open after the animation should have
 * finished — the region report for the final frame arrives after the camera
 * has settled, and a dropped frame or a busy JS thread can add a little more.
 */
export const SELF_MOVE_GRACE_MS = 200;

/**
 * Fraction of the visible latitude span a report may differ from the centre we
 * asked for and still count as our own animation arriving.
 *
 * 10 % of the screen is smaller than any deliberate drag (a driver flicking
 * the map moves it by a large part of a screen) and larger than the rounding
 * of a region report or the last few pixels of an easing curve.
 */
export const SELF_MOVE_VIEW_FRACTION = 0.1;

/**
 * Floor for that tolerance, in metres. At deep zooms 10 % of the view is a few
 * metres, which the camera's own settling can exceed; 25 m is still far below
 * any intentional pan and matches the order of the follow camera's own
 * minimum-shift guard (5 m).
 */
export const SELF_MOVE_MIN_TOLERANCE_METERS = 25;

/** Metres per degree of latitude — the span proxy's unit conversion. */
const METERS_PER_LATITUDE_DEGREE = 111_320;

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
  /**
   * Changes the zoom **without moving the centre** (the +/− buttons).
   *
   * Separate from `animateCamera` on purpose: a centre-carrying stop would
   * re-centre the map under the driver's finger while they are zooming in on
   * something they panned to, and while following it would fight the pan
   * throttle. MapLibre's `Camera.zoomTo` is exactly this stop.
   */
  setZoom(zoom: number, options: { duration: number }): void;
}

export interface FollowCameraControllerDeps {
  port: FollowCameraPort;
  /** Monotonic clock in ms. Injected so a spec can drive the throttle. */
  now: () => number;
  /** Called only when the mode actually changes, so React state can follow it. */
  onModeChange?: (mode: FollowCameraState['mode']) => void;
  /**
   * Called only when a zoom **button's** enabled state changes — not on every
   * region report. A pinch produces a region event per frame, and turning that
   * into React state would re-render the map's overlays ~60 times a second for
   * two booleans that change twice in a run.
   */
  onZoomLimitsChange?: (limits: ZoomLimits) => void;
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
  /**
   * `onRegionChange` — gesture attribution where the provider supplies it.
   * The centre is optional but wanted: without it a report cannot be checked
   * against the move we issued, and attribution is trusted as-is.
   */
  regionChanged(
    region: { latitudeDelta: number; zoom?: number; latitude?: number; longitude?: number },
    details: { isGesture?: boolean },
  ): void;
  /** `onRegionChangeComplete` — attribution, plus the zoom-delta fallback. */
  regionChangeComplete(
    region: { latitude: number; longitude: number; latitudeDelta: number; zoom?: number },
    details: { isGesture?: boolean },
  ): void;
  /**
   * The on-map +/− buttons: steps the zoom by `direction` **without** leaving
   * follow mode. A no-op (already at the bound, or no zoom observed yet)
   * returns `false` so the caller can keep the button honest.
   */
  zoomBy(direction: ZoomDirection): boolean;
  /** The zoom the engine last reported, or `null` before the first report. */
  currentZoom(): number | null;
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

/** The report's centre, when it carries one. */
function centerOf(region: { latitude?: number; longitude?: number }): CameraPoint | null {
  return typeof region.latitude === 'number' && typeof region.longitude === 'number'
    ? { latitude: region.latitude, longitude: region.longitude }
    : null;
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
  /** The zoom the engine last reported; `null` until the first region event. */
  let observedZoom: number | null = null;
  /** The latitude span the engine last reported — the tolerance's unit. */
  let observedLatitudeDelta: number | null = null;
  let publishedLimits: ZoomLimits = zoomLimits(null);
  /**
   * The camera move we issued and are still waiting to see reported back.
   * `target: null` means "we moved it but cannot predict where it lands" (a
   * bounds fit, whose final frame the port decides).
   */
  let selfMove: { target: CameraPoint | null; radiusMeters: number; expiresAt: number } | null =
    null;

  /** Records a reported zoom and tells the UI only when a button flips. */
  function observeZoom(zoom: number | undefined): void {
    if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return;
    observedZoom = zoom;
    const limits = zoomLimits(zoom);
    if (
      limits.canZoomIn === publishedLimits.canZoomIn &&
      limits.canZoomOut === publishedLimits.canZoomOut
    ) {
      return;
    }
    publishedLimits = limits;
    deps.onZoomLimitsChange?.(limits);
  }

  /** How far a report may sit from the centre we asked for and still be ours. */
  function selfMoveToleranceMeters(): number {
    const span = observedLatitudeDelta;
    if (span === null || !Number.isFinite(span) || span <= 0) {
      return SELF_MOVE_MIN_TOLERANCE_METERS;
    }
    return Math.max(
      SELF_MOVE_MIN_TOLERANCE_METERS,
      span * METERS_PER_LATITUDE_DEGREE * SELF_MOVE_VIEW_FRACTION,
    );
  }

  /**
   * Opens the self-move window for a camera command we just issued.
   * `travelledMeters` widens the radius to cover the animation's own path: the
   * intermediate frames of a 300 m recenter are up to 300 m from the target
   * and are still unmistakably ours.
   */
  function noteSelfMove(
    target: CameraPoint | null,
    durationMs: number,
    travelledMeters = 0,
  ): void {
    selfMove = {
      target,
      radiusMeters: Math.max(selfMoveToleranceMeters(), travelledMeters),
      expiresAt: deps.now() + durationMs + SELF_MOVE_GRACE_MS,
    };
  }

  /**
   * True when this region report is the camera doing what we asked.
   *
   * Deliberately conservative in both directions: a report we cannot verify
   * (no centre in the event) is *not* claimed as ours, so real attribution
   * always wins over guesswork; and a report from outside the radius is a
   * gesture even while our own animation is still running, so a driver can
   * grab the map mid-pan.
   */
  function isSelfMoveReport(center: CameraPoint | null): boolean {
    if (!selfMove) return false;
    if (deps.now() > selfMove.expiresAt) {
      selfMove = null;
      return false;
    }
    if (!center) return false;
    if (!selfMove.target) return true;
    return haversineMeters(center, selfMove.target) <= selfMove.radiusMeters;
  }

  function panTo(center: CameraPoint, duration: number): void {
    const travelled = lastCenter ? haversineMeters(lastCenter, center) : 0;
    lastCenter = { latitude: center.latitude, longitude: center.longitude };
    lastCameraAt = deps.now();
    // Android reports our own animation as `userInteraction: true` (see the
    // module header); this is what stops it from ending follow mode.
    noteSelfMove(lastCenter, duration, travelled);
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
    const duration = animated ? 500 : 1;
    if (points.length === 1) {
      noteSelfMove(points[0], duration);
      deps.port.animateCamera(points[0], {
        zoom: singlePointZoom,
        duration,
      });
      return;
    }
    // The port owns the final frame of a bounds fit (`initialCameraFor`
    // floors the zoom), so the destination is not predictable here: the
    // window is opened without a target, which claims only the reports that
    // arrive inside it.
    noteSelfMove(null, duration);
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

    regionChanged(region, details) {
      observeZoom(region.zoom);
      if (Number.isFinite(region.latitudeDelta)) observedLatitudeDelta = region.latitudeDelta;
      // The engine reports gesture attribution on the region events (MapLibre
      // sets `userInteraction` on both platforms; the binding maps it to
      // `isGesture`). Reacting to the first event rather than the last means
      // the camera stops fighting the user mid-drag instead of after the drag
      // ends — but only when the move is not the one we just asked for
      // (Android flags its own `DEVELOPER_ANIMATION` as user interaction).
      if (details.isGesture === true && !isSelfMoveReport(centerOf(region))) {
        dispatch({ type: 'user-gesture' });
      }
    },

    regionChangeComplete(region, details) {
      observeZoom(region.zoom);
      // A zoom delta we did not cause is the provider-independent second
      // signal (kept for the case where an engine stops reporting gesture
      // attribution — the old Apple-Maps situation). Follow mode only ever
      // pans, so any zoom change is a user's.
      const ours = isSelfMoveReport({ latitude: region.latitude, longitude: region.longitude });
      if (
        (details.isGesture === true && !ours) ||
        isZoomGesture(expectedDelta, region.latitudeDelta)
      ) {
        dispatch({ type: 'user-gesture' });
      }
      if (Number.isFinite(region.latitudeDelta)) observedLatitudeDelta = region.latitudeDelta;
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
      selfMove = null;
      // The native map is not remounted on a trip switch, so `onMapReady` would
      // never fire again: a fit requested before readiness must survive.
      pendingFit = !ready;
      dispatch({ type: 'trip-changed' });
    },

    recenter() {
      dispatch({ type: 'recenter' });
    },

    zoomBy(direction) {
      const target = zoomStepTarget(observedZoom, direction);
      if (target === null) return false;
      // We are about to change the zoom ourselves, so the next region report
      // must not be read as a user pinch by the zoom-delta fallback — the same
      // contract `fitToData` observes. The reducer is not involved at all: a
      // button press is not one of its events, so follow mode is untouched by
      // construction rather than by a rule that could be edited away.
      expectedDelta = null;
      observeZoom(target);
      // A zoom keeps the centre, so the centre we already know is the centre
      // the reports must carry; before the first report there is nothing to
      // compare and the window claims what arrives inside it.
      noteSelfMove(lastCenter, MAP_ZOOM_BUTTON_DURATION_MS);
      deps.port.setZoom(target, { duration: MAP_ZOOM_BUTTON_DURATION_MS });
      return true;
    },

    currentZoom() {
      return observedZoom;
    },

    isFollowing() {
      return camera.mode === 'following';
    },
  };
}
