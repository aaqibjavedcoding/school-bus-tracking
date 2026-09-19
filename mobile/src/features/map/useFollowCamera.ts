import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type MapView from 'react-native-maps';
import type { Camera, LatLng, Region } from 'react-native-maps';
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
 * Deliberately thin: a ref to the native map, a boolean for "the viewer owns the
 * camera", an `AppState` listener, and one effect per input. All the policy —
 * when to fit, when to pan, when to stop following — lives in the pure
 * controller, which is where it is unit-tested.
 *
 * ### Why following re-renders nothing
 *
 * `onFrame` is called from the marker's animation loop (~20 fps) and only
 * forwards the position to the controller, which moves the camera imperatively
 * through the native map ref. No React state is touched, so following the bus
 * costs zero renders.
 *
 * Both maps in this app use this hook — the observer map (`BusMap`) and the
 * Driver Trip map (`features/crew/DriverTripMap`) — so "what the camera does"
 * has exactly one implementation.
 */

export interface UseFollowCameraInput {
  /** Route stop coordinates, in order. Re-fitted only when the trip changes. */
  routeCoordinates: LatLng[];
  /** The newest real fix, used to frame the initial bounds. */
  fix: CameraPoint | null;
  /** Changing trip drops the fitted bounds and starts following again. */
  tripId: string | null;
  singlePointZoom?: number;
  edgePadding?: { top: number; right: number; bottom: number; left: number };
}

export interface FollowCameraBinding {
  mapRef: React.RefObject<MapView | null>;
  /** True when the viewer's gesture took the camera. Drives the recenter control. */
  exploring: boolean;
  onFrame: (marker: RenderedMarker) => void;
  onUserGesture: () => void;
  onRegionChange: (region: Region, details: { isGesture?: boolean }) => void;
  onRegionChangeComplete: (region: Region, details: { isGesture?: boolean }) => void;
  onMapReady: () => void;
  recenter: () => void;
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

export function useFollowCamera(input: UseFollowCameraInput): FollowCameraBinding {
  const { routeCoordinates, fix, tripId, singlePointZoom, edgePadding } = input;
  const mapRef = useRef<MapView | null>(null);
  const [exploring, setExploring] = useState(false);
  const controllerRef = useRef<FollowCameraController | null>(null);

  if (controllerRef.current === null) {
    const port: FollowCameraPort = {
      animateCamera: (center, options) => {
        const map = mapRef.current;
        if (!map) return;
        const camera: Partial<Camera> = {
          center: { latitude: center.latitude, longitude: center.longitude },
        };
        // The `zoom` key is only *added* when a zoom was actually asked for. A
        // follow pan must not carry a zoom at all — a present-but-undefined key
        // is not the same thing to the native camera builder as an absent one.
        if (options.zoom !== undefined) camera.zoom = options.zoom;
        map.animateCamera(camera, { duration: options.duration });
      },
      fitToCoordinates: (points, options) => {
        mapRef.current?.fitToCoordinates(points, options);
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
    (region: Region, details: { isGesture?: boolean }) =>
      // A provider that omits `details` entirely must not throw.
      controller.regionChanged(region, details ?? {}),
    [controller],
  );

  const onRegionChangeComplete = useCallback(
    (region: Region, details: { isGesture?: boolean }) =>
      controller.regionChangeComplete(region, details ?? {}),
    [controller],
  );

  const onMapReady = useCallback(() => controller.mapReady(), [controller]);

  const recenter = useCallback(() => controller.recenter(), [controller]);

  return useMemo(
    () => ({
      mapRef,
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
