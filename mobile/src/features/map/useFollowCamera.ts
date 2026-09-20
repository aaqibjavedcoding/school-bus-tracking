import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus, type NativeSyntheticEvent } from 'react-native';
import type { CameraRef, LngLat, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import {
  createFollowCameraController,
  type CameraPoint,
  type FollowCameraController,
  type FollowCameraPort,
} from './follow-camera-controller';
import type { RenderedMarker } from './useBusMarkerMotion';

/**
 * The React binding for {@link createFollowCameraController}.
 *
 * Deliberately thin: a ref to the MapLibre `Camera`, a boolean for "the
 * viewer owns the camera", an `AppState` listener, and one effect per input.
 * All the policy — when to fit, when to pan, when to stop following — lives
 * in the pure controller, which is where it is unit-tested.
 *
 * ### Why following re-renders nothing
 *
 * `onFrame` is called from the marker's animation loop (~20 fps) and only
 * forwards the position to the controller, which moves the camera imperatively
 * through the camera ref. No React state is touched, so following the bus
 * costs zero renders.
 *
 * Both maps in this app use this hook — the observer map (`BusMap`) and the
 * Driver Trip map (`features/crew/DriverTripMap`) — so "what the camera does"
 * has exactly one implementation.
 *
 * ### The MapLibre port
 *
 * The controller speaks to a two-method port (`animateCamera`,
 * `fitToCoordinates`). MapLibre's `Camera` ref satisfies it with `easeTo`
 * (centre-only, or centre+zoom for the one-point fit) and `fitBounds`
 * (padding in points, exactly the controller's edge-padding semantics).
 * Gesture attribution is the MapLibre `userInteraction` flag on the region
 * events (reported on both platforms); the zoom-delta fallback in the pure
 * controller is kept as the provider-independent second signal, fed by a
 * latitude-span proxy that is monotonic in zoom.
 */

export interface UseFollowCameraInput {
  /** Route stop coordinates, in order. Re-fitted only when the trip changes. */
  routeCoordinates: CameraPoint[];
  /** The newest real fix, used to frame the initial bounds. */
  fix: CameraPoint | null;
  /** Changing trip drops the fitted bounds and starts following again. */
  tripId: string | null;
  singlePointZoom?: number;
  edgePadding?: { top: number; right: number; bottom: number; left: number };
}

export interface FollowCameraBinding {
  /** Attach to the `<Camera>` child of the `<Map>`. */
  cameraRef: React.RefObject<CameraRef | null>;
  /** True when the viewer's gesture took the camera. Drives the recenter control. */
  exploring: boolean;
  onFrame: (marker: RenderedMarker) => void;
  onUserGesture: () => void;
  onRegionChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onRegionChangeComplete: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onMapReady: () => void;
  recenter: () => void;
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

/**
 * A latitude-span proxy for the controller's zoom-delta fallback.
 *
 * The fallback compares two region reports' latitude deltas and judges a >2 %
 * change a user zoom. MapLibre reports zoom, not a delta, so this derives the
 * latitude span the world has at that zoom (`360 / 2^zoom`); it is monotonic
 * in zoom, so its *relative* change is exactly the relative zoom change the
 * fallback is looking for.
 */
function latitudeSpanAtZoom(zoom: number): number {
  return 360 / 2 ** zoom;
}

export function useFollowCamera(input: UseFollowCameraInput): FollowCameraBinding {
  const { routeCoordinates, fix, tripId, singlePointZoom, edgePadding } = input;
  const cameraRef = useRef<CameraRef | null>(null);
  const [exploring, setExploring] = useState(false);
  const controllerRef = useRef<FollowCameraController | null>(null);

  if (controllerRef.current === null) {
    const port: FollowCameraPort = {
      animateCamera: (center, options) => {
        const camera = cameraRef.current;
        if (!camera) return;
        const stop: { center: LngLat; duration: number } & { zoom?: number } = {
          center: [center.longitude, center.latitude],
          duration: options.duration,
        };
        // The `zoom` key is only *added* when a zoom was actually asked for. A
        // follow pan must not carry a zoom at all — a present-but-undefined key
        // is not the same thing to the native camera builder as an absent one.
        if (options.zoom !== undefined) stop.zoom = options.zoom;
        camera.easeTo(stop);
      },
      fitToCoordinates: (points, options) => {
        const camera = cameraRef.current;
        if (!camera || points.length === 0) return;
        let west = points[0].longitude;
        let east = points[0].longitude;
        let south = points[0].latitude;
        let north = points[0].latitude;
        for (const point of points) {
          west = Math.min(west, point.longitude);
          east = Math.max(east, point.longitude);
          south = Math.min(south, point.latitude);
          north = Math.max(north, point.latitude);
        }
        camera.fitBounds([west, south, east, north], {
          padding: options.edgePadding,
          duration: options.animated ? 500 : 1,
        });
      },
    };
    controllerRef.current = createFollowCameraController({
      port,
      now: nowMs,
      onModeChange: (mode) => setExploring(mode !== 'following'),
      singlePointZoom,
      edgePadding,
    });
  }
  const controller = controllerRef.current;

  // Inputs are pushed into the controller rather than captured, so the
  // controller always frames *current* data even though its identity is stable.
  useEffect(() => {
    controller.setRoute(routeCoordinates);
  }, [routeCoordinates, controller]);

  useEffect(() => {
    controller.setFix(fix ? { latitude: fix.latitude, longitude: fix.longitude } : null);
  }, [fix?.latitude, fix?.longitude, controller]);

  // A new trip drops the camera state and the previous bus's rendered position.
  // This effect is declared *before* the data effects on purpose: on mount it
  // must run first, exactly as it did when this logic lived in `BusMap`.
  useEffect(() => {
    controller.tripChanged();
  }, [tripId, controller]);

  // Fit once per trip, on the first moment there is something to frame. The
  // reducer makes this idempotent: later calls return `intent: 'none'`, so a GPS
  // update can never force-fit the route back into view.
  useEffect(() => {
    controller.dataAvailable();
  }, [routeCoordinates, fix, controller]);

  useEffect(() => {
    controller.fixArrived();
  }, [fix, controller]);

  // Foreground resume: reconcile with the position that is current now, never
  // replaying the movement that happened while the app was away. The marker's
  // own AppState listener runs first (child effects register earlier), so the
  // controller already holds the reconciled position by the time this pans.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') controller.resumed();
    });
    return () => subscription.remove();
  }, [controller]);

  const onFrame = useCallback(
    (marker: RenderedMarker) => {
      controller.frame({ latitude: marker.latitude, longitude: marker.longitude });
    },
    [controller],
  );

  const onUserGesture = useCallback(() => controller.userGesture(), [controller]);

  const onRegionChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const view = event.nativeEvent;
      controller.regionChanged(
        { latitudeDelta: latitudeSpanAtZoom(view.zoom) },
        // MapLibre reports gesture attribution on every platform; a missing
        // flag is read as "not a gesture", never as "probably a gesture".
        { isGesture: view.userInteraction === true },
      );
    },
    [controller],
  );

  const onRegionChangeComplete = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const view = event.nativeEvent;
      controller.regionChangeComplete(
        {
          latitude: view.center[1],
          longitude: view.center[0],
          latitudeDelta: latitudeSpanAtZoom(view.zoom),
        },
        { isGesture: view.userInteraction === true },
      );
    },
    [controller],
  );

  const onMapReady = useCallback(() => controller.mapReady(), [controller]);

  const recenter = useCallback(() => controller.recenter(), [controller]);

  return useMemo(
    () => ({
      cameraRef,
      exploring,
      onFrame,
      onUserGesture,
      onRegionChange,
      onRegionChangeComplete,
      onMapReady,
      recenter,
    }),
    [
      exploring,
      onFrame,
      onUserGesture,
      onRegionChange,
      onRegionChangeComplete,
      onMapReady,
      recenter,
    ],
  );
}
