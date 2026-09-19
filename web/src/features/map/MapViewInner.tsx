'use client';

import L from 'leaflet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import type { LiveFix } from '../tracking/useLiveTripTracking';
import type { MapViewProps } from './types';
import { busIconOptions, setBusIconHeading } from './bus-marker-icon';
import { FRAME_MIN_INTERVAL_MS, createBusMotion } from './bus-motion';
import { haversineMeters } from './geo';
import {
  FOLLOW_CAMERA_MIN_SHIFT_METERS,
  FOLLOW_CAMERA_THROTTLE_MS,
  INITIAL_FOLLOW_CAMERA,
  reduceFollowCamera,
  type FollowCameraEvent,
  type FollowCameraState,
} from './follow-camera';
import { deriveTrackingPresentation } from './tracking-presentation';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Web live-tracking map (Leaflet + OpenStreetMap).
 *
 * ### Where positions come from, and where they do not
 *
 * The only coordinates drawn are the route's stops and GPS fixes from the
 * existing Socket.IO namespace. Between fixes the marker is interpolated —
 * presentation only. Interpolated values never leave the marker: ETA, stop
 * progress, attendance and notifications all keep reading the raw fix.
 *
 * **Interpolation is not road matching.** Two sparse points are joined by a
 * straight line, so on a bend the bus cuts the corner. The dashed line between
 * stops is the same kind of straight line, and the console says so rather than
 * implying a routing engine.
 *
 * ### What changed here
 *
 * - The `🚌` emoji became a top-view SVG that actually points where the heading
 *   says it does (`bus-marker-icon.ts`), matching the native marker.
 * - The hardcoded 900 ms tween — a third of the real ~4 s cadence, which made
 *   the bus lurch and then sit — is replaced by a cadence-derived tween from the
 *   same pure state machine the native map uses (`bus-motion.ts`), with
 *   duplicate/out-of-order, jitter, gap, implausible-jump and stale handling.
 * - The camera is no longer re-fitted on every fix: it fits once per trip, then
 *   only pans while following, and a user gesture hands it to the user.
 * - Rotation and position are applied imperatively to the Leaflet marker, so no
 *   React state changes per frame and the icon DOM is never rebuilt.
 */

// Pinned to the single canonical tile host (no `{s}` subdomains) so the CSP
// `img-src` allowlist in `security-headers.js` stays exact:
// `https://tile.openstreetmap.org`. OpenStreetMap serves this host directly.
//
// Note on cost: this is OpenStreetMap's public tile server, used under its
// tile-usage policy — it is free but **not** unlimited, and heavy traffic from
// a production console is expected to move to a self-hosted or contracted tile
// provider. Nothing in this change alters the tile source.
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const SINGLE_POINT_ZOOM = 15;
const MAX_FIT_ZOOM = 16;
const FIT_PADDING: [number, number] = [36, 36];

/**
 * How long gesture detection is suspended after we change the zoom ourselves.
 *
 * `fitBounds` dispatches `zoomstart` from inside a `requestAnimFrame`
 * (`Map.js` `_tryAnimatedZoom`), so it lands *after* the call returns — a flag
 * set and cleared synchronously around the call would miss it. 1500 ms covers
 * Leaflet's default 250 ms zoom animation plus a frame, and the window only
 * ever opens once per trip, right after the fit.
 */
const SELF_ZOOM_SUPPRESSION_MS = 1_500;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

type LatLngTuple = [number, number];

// ── The bus marker ─────────────────────────────────────────────────────────

interface RenderedMarker {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
}

const SmoothBusMarker: React.FC<{
  fix: LiveFix;
  reducedMotion: boolean;
  animate: boolean;
  /** Imperative per-frame hook for the follow camera. Not a React callback. */
  onFrame: (marker: RenderedMarker) => void;
}> = ({ fix, reducedMotion, animate, onFrame }) => {
  const markerRef = useRef<L.Marker | null>(null);
  const motionRef = useRef(createBusMotion({ reducedMotion }));
  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Read once. react-leaflet calls `setLatLng` whenever this prop *changes*, so
  // keeping it constant is what stops React from yanking the marker to the
  // tween's destination while the animation is still travelling there.
  const mountPosition = useRef<LatLngTuple>([fix.latitude, fix.longitude]);
  const iconRef = useRef<L.DivIcon>(L.divIcon(busIconOptions()));

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const apply = useCallback((now: number) => {
    const rendered = motionRef.current.sample(now);
    if (!rendered) return;
    markerRef.current?.setLatLng([rendered.latitude, rendered.longitude]);
    setBusIconHeading(markerRef.current, rendered.headingDeg);
    onFrameRef.current?.({
      latitude: rendered.latitude,
      longitude: rendered.longitude,
      headingDeg: rendered.headingDeg,
    });
  }, []);

  const startLoop = useCallback(() => {
    if (frameRef.current !== null) return;
    const tick = (now: number) => {
      frameRef.current = null;
      // Frame cap shared with the native map: ~20 fps, at which a bus at
      // 40 km/h moves about half a metre per frame — sub-pixel at this zoom.
      if (now - lastFrameAtRef.current >= FRAME_MIN_INTERVAL_MS) {
        lastFrameAtRef.current = now;
        apply(now);
      }
      if (motionRef.current.isAnimating()) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [apply]);

  // Reduced motion can change while the page is open.
  useEffect(() => {
    motionRef.current.setReducedMotion(reducedMotion);
    stopLoop();
    apply(nowMs());
  }, [reducedMotion, apply, stopLoop]);

  // Freshness: a stale position must stop travelling and stay where it is.
  useEffect(() => {
    if (animate) {
      motionRef.current.resume();
    } else {
      motionRef.current.halt();
      stopLoop();
      apply(nowMs());
    }
  }, [animate, apply, stopLoop]);

  // A new fix.
  useEffect(() => {
    const now = nowMs();
    const outcome = motionRef.current.push(
      {
        latitude: fix.latitude,
        longitude: fix.longitude,
        heading: fix.heading,
        speed: fix.speed,
        accuracy: fix.accuracy,
        recorded_at: fix.recorded_at,
      },
      now,
    );
    lastFrameAtRef.current = now;
    apply(now);
    // A duplicate / out-of-order / invalid fix must not restart a tween that is
    // already correctly in flight.
    if (outcome.action === 'animated') startLoop();
  }, [fix, apply, startLoop]);

  // Background/foreground: reconcile with the current fix on return; never
  // replay the movement that happened while the tab was hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        apply(nowMs());
        if (motionRef.current.isAnimating()) startLoop();
        return;
      }
      motionRef.current.cancelAnimation();
      stopLoop();
      apply(nowMs());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [apply, startLoop, stopLoop]);

  // Unmount / trip switch: nothing may keep requesting frames.
  useEffect(
    () => () => {
      motionRef.current.cancelAnimation();
      stopLoop();
    },
    [stopLoop],
  );

  const showSpeed = animate && fix.speed !== null;

  return (
    <Marker
      position={mountPosition.current}
      icon={iconRef.current}
      zIndexOffset={800}
      ref={(marker) => {
        markerRef.current = marker;
        if (marker) {
          // Place the marker at the first real fix before the first frame runs,
          // so it never flashes at the mount coordinate.
          marker.setLatLng([fix.latitude, fix.longitude]);
          setBusIconHeading(marker, fix.heading);
        }
      }}
      eventHandlers={{
        add: () => {
          // Re-apply after Leaflet attaches the element to the DOM; `setLatLng`
          // in the ref callback can run before the icon element exists.
          apply(nowMs());
        },
      }}
    >
      <Popup>
        <strong>School bus</strong>
        <div>
          {animate
            ? `Updated ${formatRelative(fix.received_at)}`
            : `Last known ${formatTime(fix.recorded_at)}`}
        </div>
        <div>{showSpeed ? formatSpeedKmh(fix.speed) : 'Speed not reported'}</div>
        {fix.accuracy !== null && fix.accuracy > 50 ? (
          <div>Position approximate (±{Math.round(fix.accuracy)} m)</div>
        ) : null}
      </Popup>
    </Marker>
  );
};

// ── Camera controller ──────────────────────────────────────────────────────

const MapController: React.FC<{
  fix: LiveFix | null;
  stops: Array<{ latitude: number; longitude: number }>;
  renderedRef: React.MutableRefObject<RenderedMarker | null>;
  followRef: React.MutableRefObject<FollowCameraState>;
  onModeChange: (exploring: boolean) => void;
  recenterRef: React.MutableRefObject<(() => void) | null>;
  panRef: React.MutableRefObject<((durationMs: number, force: boolean) => void) | null>;
}> = ({ fix, stops, renderedRef, followRef, onModeChange, recenterRef, panRef }) => {
  const map = useMap();
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const lastCenterRef = useRef<LatLngTuple | null>(null);
  const lastCameraAtRef = useRef(0);
  const selfZoomUntilRef = useRef(0);

  const panTo = useCallback(
    (target: LatLngTuple, durationSeconds: number) => {
      lastCenterRef.current = target;
      lastCameraAtRef.current = nowMs();
      // `panTo` never changes zoom, so a GPS update can never change how far the
      // user has zoomed — and it never fires `dragstart` or `zoomstart`, which
      // is what keeps our own camera moves from knocking the user out of follow
      // mode.
      map.panTo(target, { animate: true, duration: durationSeconds });
    },
    [map],
  );

  const maybeFollowPan = useCallback(
    (durationSeconds: number, force: boolean) => {
      const target = renderedRef.current;
      if (!target) return;
      if (!force && nowMs() - lastCameraAtRef.current < FOLLOW_CAMERA_THROTTLE_MS) return;
      const previous = lastCenterRef.current;
      const asCoordinate = { latitude: target.latitude, longitude: target.longitude };
      if (
        previous &&
        haversineMeters({ latitude: previous[0], longitude: previous[1] }, asCoordinate) <
          FOLLOW_CAMERA_MIN_SHIFT_METERS
      ) {
        return;
      }
      // Slightly longer than the throttle so consecutive pans overlap instead of
      // stepping — that overlap is what a smooth trailing camera is.
      panTo([target.latitude, target.longitude], durationSeconds / 1000);
    },
    [panTo, renderedRef],
  );

  const fitToData = useCallback(() => {
    const points: LatLngTuple[] = stops.map((stop) => [stop.latitude, stop.longitude]);
    const current = fixRef.current;
    if (current) points.push([current.latitude, current.longitude]);
    if (points.length === 0) return;

    // We are about to change the zoom ourselves; `zoomstart` lands on the next
    // animation frame, so suppress gesture detection for a short window.
    selfZoomUntilRef.current = Date.now() + SELF_ZOOM_SUPPRESSION_MS;
    lastCenterRef.current = null;
    if (points.length === 1) {
      map.setView(points[0], SINGLE_POINT_ZOOM, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(points), {
      padding: FIT_PADDING,
      maxZoom: MAX_FIT_ZOOM,
      animate: false,
    });
  }, [map, stops]);

  const dispatch = useCallback(
    (event: FollowCameraEvent) => {
      const previous = followRef.current;
      const next = reduceFollowCamera(previous, event);
      followRef.current = next;
      if (next.mode !== previous.mode) onModeChange(next.mode === 'exploring');
      if (next.intent === 'fit') fitToData();
      else if (next.intent === 'pan') maybeFollowPan(FOLLOW_CAMERA_THROTTLE_MS, true);
    },
    [fitToData, followRef, maybeFollowPan, onModeChange],
  );

  // Fit once per trip. The reducer makes this idempotent: later calls return
  // `intent: 'none'`, so a GPS update can never force-fit the route back.
  useEffect(() => {
    if (stops.length > 0 || fix) dispatch({ type: 'data-available' });
  }, [dispatch, fix, stops.length]);

  useEffect(() => {
    if (fix) dispatch({ type: 'fix-arrived' });
  }, [dispatch, fix]);

  // Foreground resume: reconcile with the current position, replay nothing.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') dispatch({ type: 'resumed' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [dispatch]);

  // Gesture detection. `dragstart` and `boxzoomstart` only ever come from the
  // user, and `panTo` fires neither — so a programmatic follow pan cannot knock
  // the user out of follow mode. `zoomstart` needs the self-zoom window above,
  // because `fitBounds` is the one zoom change we do make.
  useEffect(() => {
    const onUserGesture = () => dispatch({ type: 'user-gesture' });
    const onZoomStart = () => {
      if (Date.now() >= selfZoomUntilRef.current) onUserGesture();
    };
    map.on('dragstart', onUserGesture);
    map.on('boxzoomstart', onUserGesture);
    map.on('zoomstart', onZoomStart);
    return () => {
      map.off('dragstart', onUserGesture);
      map.off('boxzoomstart', onUserGesture);
      map.off('zoomstart', onZoomStart);
    };
  }, [dispatch, map]);

  // Expose "Follow bus" to the button rendered outside the map container, and
  // the throttled follow-pan to the marker's per-frame loop.
  useEffect(() => {
    recenterRef.current = () => dispatch({ type: 'recenter' });
    return () => {
      recenterRef.current = null;
    };
  }, [dispatch, recenterRef]);

  useEffect(() => {
    panRef.current = maybeFollowPan;
    return () => {
      panRef.current = null;
    };
  }, [maybeFollowPan, panRef]);

  return null;
};

/** Wraps the frame callback so the camera controller can consume it. */
function useFrameHandler(
  followRef: React.MutableRefObject<FollowCameraState>,
  renderedRef: React.MutableRefObject<RenderedMarker | null>,
  panRef: React.MutableRefObject<((duration: number, force: boolean) => void) | null>,
) {
  return useCallback(
    (rendered: RenderedMarker) => {
      renderedRef.current = rendered;
      if (followRef.current.mode !== 'following') return;
      panRef.current?.(FOLLOW_CAMERA_THROTTLE_MS + 50, false);
    },
    [followRef, panRef, renderedRef],
  );
}

// ── The map ────────────────────────────────────────────────────────────────

export const MapViewInner: React.FC<MapViewProps> = ({
  fix,
  stops = [],
  highlightStopId = null,
  connection = 'offline',
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const [exploring, setExploring] = useState(false);
  const [tick, setTick] = useState(0);

  // So freshness labels age without new data: a connected socket with a
  // four-minute-old fix must stop reading as live.
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const mappedStops = useMemo(
    () =>
      stops.filter(
        (stop): stop is StopResponse & { latitude: number; longitude: number } =>
          stop.latitude != null && stop.longitude != null,
      ),
    [stops],
  );
  const line = useMemo(
    () =>
      mappedStops
        .slice()
        .sort((a, b) => a.sequence_number - b.sequence_number)
        .map((stop) => [stop.latitude, stop.longitude] as LatLngTuple),
    [mappedStops],
  );

  const presentation = useMemo(
    () =>
      deriveTrackingPresentation({
        fixAgeMs: fix ? Date.now() - new Date(fix.received_at).getTime() : null,
        accuracyMeters: fix?.accuracy ?? null,
        socketOffline: connection === 'offline',
      }),
    // `tick` is what makes this recompute on the ageing interval.
    [fix, connection, tick],
  );

  const renderedRef = useRef<RenderedMarker | null>(null);
  const followRef = useRef<FollowCameraState>(INITIAL_FOLLOW_CAMERA);
  const recenterRef = useRef<(() => void) | null>(null);
  const panRef = useRef<((duration: number, force: boolean) => void) | null>(null);
  const handleFrame = useFrameHandler(followRef, renderedRef, panRef);

  const hasAnything = mappedStops.length > 0 || fix !== null;

  if (!hasAnything) {
    return (
      <div className="map-shell">
        <div className="empty">
          <p className="muted">No GPS position or mapped stops for this trip yet.</p>
        </div>
      </div>
    );
  }

  const center: LatLngTuple = fix
    ? [fix.latitude, fix.longitude]
    : [mappedStops[0].latitude, mappedStops[0].longitude];

  return (
    <div className="map-shell">
      <MapContainer center={center} zoom={SINGLE_POINT_ZOOM - 1} scrollWheelZoom attributionControl>
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <MapController
          fix={fix}
          stops={mappedStops}
          renderedRef={renderedRef}
          followRef={followRef}
          onModeChange={setExploring}
          recenterRef={recenterRef}
          panRef={panRef}
        />

        {line.length > 1 ? (
          <Polyline positions={line} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.55 }} />
        ) : null}

        {mappedStops.map((stop) => (
          <Marker
            key={stop.id}
            position={[stop.latitude, stop.longitude]}
            icon={stopIcon(stop.sequence_number, highlightStopId === stop.id ? 'current' : 'plain')}
          >
            <Popup>
              <strong>
                Stop {stop.sequence_number}: {stop.name}
              </strong>
              {stop.address ? <div>{stop.address}</div> : null}
            </Popup>
          </Marker>
        ))}

        {fix && presentation.accuracyCircleMeters !== null ? (
          <Circle
            center={[fix.latitude, fix.longitude]}
            radius={presentation.accuracyCircleMeters}
            pathOptions={{ color: '#f59e0b', weight: 1, fillColor: '#f59e0b', fillOpacity: 0.13 }}
          />
        ) : null}

        {fix ? (
          <SmoothBusMarker
            fix={fix}
            reducedMotion={reducedMotion}
            animate={presentation.animate}
            onFrame={handleFrame}
          />
        ) : null}
      </MapContainer>

      {/* Top-right: clear of Leaflet's zoom control (top-left), its attribution
          control (bottom-right) and the console's own overlay card. */}
      {exploring ? (
        <button
          type="button"
          className="map-follow-control"
          onClick={() => recenterRef.current?.()}
          aria-label="Follow bus"
        >
          Follow bus
        </button>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {exploring ? 'Map exploration — follow paused' : 'Following the bus'}
      </span>
    </div>
  );
};

function stopIcon(sequence: number, kind: 'plain' | 'next' | 'current'): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="stop-marker ${kind}">${sequence}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -10],
  });
}
