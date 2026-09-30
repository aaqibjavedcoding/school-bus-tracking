'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { APP_CONFIG } from '@school-bus-tracking/config';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
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
import { resolveMapStyleUrl } from './map-style';
import { accuracyCirclePolygon } from './accuracy-circle';
import {
  ACCURACY_SOURCE_ID,
  ROUTE_SOURCE_ID,
  TRAIL_SOURCE_ID,
  createOverlaySync,
  type OverlayStop,
} from './overlay-sync';
import {
  MAP_FAILED_MESSAGE,
  STYLE_RESET_DELAYS_MS,
  createMapErrorTracker,
  type MapErrorNotice,
} from './map-error-policy';

/**
 * Web live-tracking map — MapLibre GL JS + OpenFreeMap (vector tiles).
 *
 * This is a full engine port from previous raster engine (raster tiles from the former OSM raster host) to MapLibre GL JS (vector tiles from
 * tiles.openfreemap.org/styles/bright). The pure policy modules remain
 * untouched: bus-motion, follow-camera, tracking-presentation, bus-marker-icon
 * geometry.
 *
 * Responsibilities:
 * - One map instance per mount, style resolved by map-style.ts (https-only).
 * - Fit-to-route once per trip, centre-only follow, gesture suspension via
 *   MapLibre's `originalEvent` on move events.
 * - Foreground resume reconciles with current position.
 * - Bus marker as maplibregl.Marker with existing SVG and imperative heading.
 * - Stops as markers, route as GeoJSON line layer, accuracy ring as GeoJSON
 *   polygon fill+line layer (mirrors mobile's accuracy-circle.ts).
 * - Attribution control visible, WebGL-missing browsers get labelled empty state.
 *
 * ### Two ordering rules this file must never lose again
 *
 * 1. **`mapReady` is an input, not an early return.** The map is built by an
 *    effect gated on the async WebGL2 check, so it does not exist on the first
 *    render. Every effect that writes to the map therefore depends on
 *    `mapReady` and goes through one `syncOverlays()` routine (`overlay-sync.ts`),
 *    which the `load` handler calls too. Before this, the bus-marker effect
 *    returned early on a missing map and never re-ran, so a trip whose only fix
 *    came from the REST snapshot had no bus at all.
 * 2. **A MapLibre `error` event is not a verdict.** The engine fires it for
 *    every 404 tile and every request aborted by a pan. `map-error-policy.ts`
 *    decides what is style-level, how many consecutive failures justify telling
 *    anyone, and which words are honest; a successful `idle` / `styledata`
 *    clears the notice with no restart and no tap.
 */

const SINGLE_POINT_ZOOM = 15;
const MAX_FIT_ZOOM = 16;
const FIT_PADDING = 36;

/**
 * The lowest zoom a fit may settle at.
 *
 * `fitBounds` settles on the **lowest** zoom that contains every stop, and a
 * route spans several kilometres, so an unfloored fit lands around z10–z11 — the
 * zoom at which a street map has no reason to draw road, area or place names,
 * which made the tracking map look like an unlabeled outline. Holding the fit at
 * a readable zoom is half of "show labels like a normal map"; the style choice in
 * `map-style.ts` is the other half.
 */
const MIN_FIT_ZOOM = 13;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

type LatLngTuple = [number, number];

interface RenderedMarker {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
}

function createBusMarkerElement(): HTMLDivElement {
  const options = busIconOptions();
  const container = document.createElement('div');
  container.className = options.className;
  // options.html is `<div class="bus-marker-anchor"><div class="bus-marker-rotor">SVG</div></div>`
  container.innerHTML = options.html;
  // The box stays zero-sized on purpose (see `.bus-marker` in `globals.css`):
  // MapLibre positions and sizes this element itself, so the graphic must live in
  // an absolutely positioned child, or a rotated bus is clipped to its own
  // unrotated footprint and loses its corners on a diagonal heading.
  container.style.cssText = 'width:0;height:0;overflow:visible;';
  return container;
}

function createStopMarkerElement(
  sequence: number,
  kind: 'plain' | 'next' | 'current',
  name: string,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `stop-marker ${kind}`;
  el.textContent = String(sequence);
  // Always-visible stop name + sequence (the shared `map.stopLabel` template
  // '{number}. {name}' — mobile's StopMarker shows the same). The popup stays
  // a click affordance; the label is the reading affordance. Absolutely
  // positioned so the dot's 22px box — and the marker anchor math — never
  // change and the label cannot block map gestures.
  const label = document.createElement('span');
  label.className = 'stop-marker-label';
  label.textContent = `${sequence}. ${name}`;
  el.appendChild(label);
  return el;
}

export const MapViewInner: React.FC<MapViewProps> = ({
  fix,
  stops = [],
  highlightStopId = null,
  nextStopId = null,
  trail,
  controls,
  connection = 'offline',
  onMapError,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const [exploring, setExploring] = useState(false);
  const [tick, setTick] = useState(0);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  /**
   * The explicit readiness signal (defect A).
   *
   * `mapRef.current !== null` is invisible to React, so an effect could never
   * re-run "when the map appears". This state can, and every effect that
   * mutates the map lists it in its dependency array.
   */
  const [mapReady, setMapReady] = useState(false);
  /** The same signal, readable synchronously from inside `map.on('load')`. */
  const mapReadyRef = useRef(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const busMarkerRef = useRef<maplibregl.Marker | null>(null);
  const busElementRef = useRef<HTMLDivElement | null>(null);
  const busPopupRef = useRef<maplibregl.Popup | null>(null);
  const motionRef = useRef(createBusMotion({ reducedMotion }));
  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const renderedRef = useRef<RenderedMarker | null>(null);
  const followRef = useRef<FollowCameraState>(INITIAL_FOLLOW_CAMERA);
  const lastCenterRef = useRef<LatLngTuple | null>(null);
  const lastCameraAtRef = useRef(0);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const recenterRef = useRef<(() => void) | null>(null);
  const panRef = useRef<((durationMs: number, force: boolean) => void) | null>(null);
  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;

  // One resolved style URL for the whole mount: the map init, the bounded
  // re-set retry and the error classifier must all mean the same document.
  const styleUrl = useMemo(
    () => resolveMapStyleUrl({ NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL }),
    [],
  );

  /**
   * The overlay writer (`overlay-sync.ts`). Created once; the ports below are
   * the only MapLibre/DOM code in the whole overlay path, so the ordering
   * rules stay in a module a spec can drive with a fake map.
   */
  const overlaysRef = useRef(
    createOverlaySync<
      maplibregl.Map,
      maplibregl.Marker,
      { marker: maplibregl.Marker; element: HTMLDivElement }
    >({
      getSource: (map, id) =>
        (map.getSource(id) as maplibregl.GeoJSONSource | undefined) ?? null,

      createBusMarker: (map, lngLat) => {
        const el = createBusMarkerElement();
        busElementRef.current = el;
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .addTo(map);
        const popup = new maplibregl.Popup({ offset: 24, closeButton: true });
        busPopupRef.current = popup;
        marker.setPopup(popup);
        busMarkerRef.current = marker;
        return marker;
      },
      moveBusMarker: (marker, lngLat) => {
        marker.setLngLat(lngLat);
      },
      removeBusMarker: (marker) => {
        marker.remove();
        busMarkerRef.current = null;
        busElementRef.current = null;
        busPopupRef.current = null;
      },

      createStopMarker: (map, stop, kind) => {
        const element = createStopMarkerElement(stop.sequence_number, kind, stop.name);
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([stop.longitude, stop.latitude])
          .addTo(map);
        const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
          `<strong>Stop ${stop.sequence_number}: ${escapeHtml(stop.name)}</strong>${
            stop.address ? `<div>${escapeHtml(stop.address)}</div>` : ''
          }`,
        );
        marker.setPopup(popup);
        return { marker, element };
      },
      updateStopMarker: ({ marker, element }, stop, kind) => {
        // 3E speed: mutate in place so a highlight change never recreates the
        // marker (and never recreates its popup).
        marker.setLngLat([stop.longitude, stop.latitude]);
        const expectedLabel = `${stop.sequence_number}. ${stop.name}`;
        const labelSpan = element.querySelector('.stop-marker-label') as HTMLSpanElement | null;
        if (labelSpan && labelSpan.textContent !== expectedLabel) {
          labelSpan.textContent = expectedLabel;
        }
        if (element.firstChild && element.firstChild.nodeType === 3) {
          const seqText = String(stop.sequence_number);
          if (element.firstChild.textContent !== seqText) {
            element.firstChild.textContent = seqText;
          }
        } else {
          // Fallback: recreate if the structure is unexpected.
          element.textContent = String(stop.sequence_number);
          const lbl = document.createElement('span');
          lbl.className = 'stop-marker-label';
          lbl.textContent = expectedLabel;
          element.appendChild(lbl);
        }
        const expectedClass = `stop-marker ${kind}`;
        if (element.className !== expectedClass) element.className = expectedClass;
      },
      removeStopMarker: ({ marker }) => marker.remove(),
    }),
  );

  /**
   * Map-error policy state. The tracker decides *whether* to speak; this ref
   * remembers what was last said so the surface is only told about changes.
   */
  const errorTrackerRef = useRef(createMapErrorTracker({ styleUrl }));
  const lastNoticeRef = useRef<MapErrorNotice['kind']>('none');
  const styleResetsRef = useRef(0);
  const styleResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tell the surface only when the *verdict* changes. A map that is failing
   * emits errors in bursts; re-rendering the badge per tile would be the same
   * noise in a different place.
   */
  const publishNotice = useCallback((notice: MapErrorNotice) => {
    if (notice.kind === lastNoticeRef.current) return;
    lastNoticeRef.current = notice.kind;
    onMapErrorRef.current?.(
      notice.kind === 'none'
        ? null
        : {
            message: notice.message ?? MAP_FAILED_MESSAGE,
            terminal: notice.kind === 'failed',
            codes: notice.codes,
          },
    );
  }, []);

  const mappedStops = useMemo(
    () =>
      stops.filter(
        (stop): stop is StopResponse & { latitude: number; longitude: number } =>
          stop.latitude != null && stop.longitude != null,
      ),
    [stops],
  );

  const lineCoords = useMemo(
    () =>
      mappedStops
        .slice()
        .sort((a, b) => a.sequence_number - b.sequence_number)
        .map((stop) => [stop.longitude, stop.latitude] as [number, number]),
    [mappedStops],
  );

  // Driven-path breadcrumb (crew console). GeoJSON expects [lng, lat].
  const trailCoords = useMemo(
    () =>
      (trail ?? [])
        .filter(
          (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
        )
        .map((point) => [point.longitude, point.latitude] as [number, number]),
    [trail],
  );

  // Declared before the map-init effect: its deps gate map creation. The
  // empty state renders no container div, so the map may only initialise (or
  // re-initialise) once there is something to show.
  const hasAnything = mappedStops.length > 0 || fix !== null;

  const presentation = useMemo(
    () =>
      deriveTrackingPresentation({
        fixAgeMs: fix ? Date.now() - new Date(fix.received_at).getTime() : null,
        accuracyMeters: fix?.accuracy ?? null,
        socketOffline: connection === 'offline',
      }),
    // `tick` is in the deps so freshness ages without a new fix arriving.
    [fix, connection, tick],
  );

  // Freshness aging tick
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  // Reduced motion live update
  useEffect(() => {
    motionRef.current.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  // WebGL2 support check (MapLibre GL JS v5+ requires WebGL2; supported() was removed)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        const gl =
          canvas.getContext('webgl2') ||
          // fallback to webgl for older checks, but MapLibre v5 needs webgl2
          canvas.getContext('webgl');
        setWebglSupported(!!gl);
      } catch {
        setWebglSupported(false);
      }
    }
  }, []);

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const applyFrame = useCallback((now: number) => {
    const rendered = motionRef.current.sample(now);
    if (!rendered) return;
    const lngLat: [number, number] = [rendered.longitude, rendered.latitude];
    busMarkerRef.current?.setLngLat(lngLat);
    if (busElementRef.current) {
      setBusIconHeading(busElementRef.current, rendered.headingDeg);
    }
    renderedRef.current = {
      latitude: rendered.latitude,
      longitude: rendered.longitude,
      headingDeg: rendered.headingDeg,
    };
    // Imperative camera follow hook
    if (followRef.current.mode === 'following') {
      panRef.current?.(FOLLOW_CAMERA_THROTTLE_MS + 50, false);
    }
  }, []);

  const startLoop = useCallback(() => {
    if (frameRef.current !== null) return;
    const tickFrame = (now: number) => {
      frameRef.current = null;
      if (now - lastFrameAtRef.current >= FRAME_MIN_INTERVAL_MS) {
        lastFrameAtRef.current = now;
        applyFrame(now);
      }
      if (motionRef.current.isAnimating()) {
        frameRef.current = requestAnimationFrame(tickFrame);
      }
    };
    frameRef.current = requestAnimationFrame(tickFrame);
  }, [applyFrame]);

  // Pan helper (centre-only, preserves zoom)
  const panTo = useCallback((target: LatLngTuple, durationSeconds: number) => {
    const map = mapRef.current;
    if (!map) return;
    lastCenterRef.current = target;
    lastCameraAtRef.current = nowMs();
    map.panTo([target[1], target[0]], {
      animate: true,
      duration: durationSeconds * 1000,
    });
  }, []);

  const maybeFollowPan = useCallback(
    (durationMs: number, force: boolean) => {
      const target = renderedRef.current;
      if (!target) return;
      if (!force && nowMs() - lastCameraAtRef.current < FOLLOW_CAMERA_THROTTLE_MS) return;
      const previous = lastCenterRef.current;
      if (previous) {
        const dist = haversineMeters(
          { latitude: previous[0], longitude: previous[1] },
          { latitude: target.latitude, longitude: target.longitude },
        );
        if (dist < FOLLOW_CAMERA_MIN_SHIFT_METERS) return;
      }
      panTo([target.latitude, target.longitude], durationMs / 1000);
    },
    [panTo],
  );

  const fitToData = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: LatLngTuple[] = mappedStops.map((s) => [s.latitude, s.longitude]);
    const current = fixRef.current;
    if (current) points.push([current.latitude, current.longitude]);
    if (points.length === 0) return;

    lastCenterRef.current = null;
    if (points.length === 1) {
      map.setCenter([points[0][1], points[0][0]]);
      map.setZoom(SINGLE_POINT_ZOOM);
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const p of points) {
      bounds.extend([p[1], p[0]]);
    }
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      minZoom: MIN_FIT_ZOOM,
      maxZoom: MAX_FIT_ZOOM,
      animate: false,
    });
  }, [mappedStops]);

  const dispatch = useCallback(
    (event: FollowCameraEvent) => {
      const previous = followRef.current;
      const next = reduceFollowCamera(previous, event);
      followRef.current = next;
      if (next.mode !== previous.mode) {
        setExploring(next.mode === 'exploring');
      }
      if (next.intent === 'fit') fitToData();
      else if (next.intent === 'pan') maybeFollowPan(FOLLOW_CAMERA_THROTTLE_MS, true);
    },
    [fitToData, maybeFollowPan],
  );

  // ── Overlay sync ─────────────────────────────────────────────────────────

  const accuracyFeature = useMemo(() => {
    if (!fix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: fix.latitude, longitude: fix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [fix, presentation.accuracyCircleMeters]);

  const overlayStops = useMemo<OverlayStop[]>(
    () =>
      mappedStops.map((stop) => ({
        id: stop.id,
        latitude: stop.latitude,
        longitude: stop.longitude,
        sequence_number: stop.sequence_number,
        name: stop.name,
        address: stop.address ?? null,
      })),
    [mappedStops],
  );

  /**
   * Write everything the map should be showing, now.
   *
   * Called from `map.on('load')` **and** from the data effects, so the order
   * in which the map and the data arrive stops mattering: whichever is last
   * triggers the write. `overlay-sync.ts` no-ops (losing nothing) when there
   * is no ready map, because the caller always passes current data.
   */
  const syncOverlays = useCallback(() => {
    const result = overlaysRef.current.sync({
      map: mapRef.current,
      // The ref, not the state: `map.on('load')` fires before React has
      // committed `setMapReady(true)`, and that first sync must still land.
      ready: mapReadyRef.current,
      data: {
        fix: fix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
        routeCoordinates: lineCoords,
        trailCoordinates: trailCoords,
        accuracyFeature,
        stops: overlayStops,
        highlightStopId,
        nextStopId,
      },
    });
    // The bus exists for the first time: frame it, unless the camera has
    // already been fitted (or handed to the user) for this trip.
    if (result.busMarkerCreated && !followRef.current.hasFitted) {
      dispatch({ type: 'data-available' });
    }
    return result;
  }, [
    fix,
    lineCoords,
    trailCoords,
    accuracyFeature,
    overlayStops,
    highlightStopId,
    nextStopId,
    dispatch,
  ]);

  // The `load` handler is registered once, at map creation; without these
  // refs it would call the `syncOverlays` — and the camera reducer — of that
  // one render forever.
  const syncOverlaysRef = useRef(syncOverlays);
  syncOverlaysRef.current = syncOverlays;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Expose recenter and pan for button and frame loop
  useEffect(() => {
    recenterRef.current = () => dispatch({ type: 'recenter' });
    return () => {
      recenterRef.current = null;
    };
  }, [dispatch]);

  // "Fit route" (opt-in via `controls`): fit the bounds and hand the camera
  // to the user — entering explore mode keeps the next GPS fix from panning
  // the freshly fitted view away; "Follow bus" hands it back.
  const fitRouteRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    fitRouteRef.current = () => {
      dispatch({ type: 'user-gesture' });
      fitToData();
    };
    return () => {
      fitRouteRef.current = null;
    };
  }, [dispatch, fitToData]);

  useEffect(() => {
    panRef.current = maybeFollowPan;
    return () => {
      panRef.current = null;
    };
  }, [maybeFollowPan]);

  // Map initialization
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;
    if (webglSupported === false) return;
    if (webglSupported === null) return; // wait for check

    const initialCenter: [number, number] = fix
      ? [fix.longitude, fix.latitude]
      : mappedStops.length > 0
        ? [mappedStops[0].longitude, mappedStops[0].latitude]
        : [0, 0];

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrl,
        center: initialCenter,
        zoom: SINGLE_POINT_ZOOM - 1,
        attributionControl: { compact: false },
      });
    } catch (error) {
      // The engine could not even be constructed: nothing will retry this,
      // so it is terminal the moment it happens.
      console.error('[MapView] map initialization failed', error);
      publishNotice(errorTrackerRef.current.fail('style:init'));
      return;
    }

    mapRef.current = map;

    /**
     * True once our sources and layers live in the *current* style.
     *
     * `map.setStyle()` throws the whole style away, custom sources and layers
     * included, so a re-set has to clear this and let `onStyleReady` put them
     * back. (MapLibre `Marker`s are DOM overlays on the container, not style
     * objects, so the bus and the stops survive a re-set untouched.)
     */
    let overlaysInstalled = false;

    /** Ask the engine to load the style again — the retry, in one place. */
    const reloadStyle = (reason: string) => {
      if (mapRef.current !== map) return;
      overlaysInstalled = false;
      try {
        map.setStyle(styleUrl);
      } catch (error) {
        console.error(`[MapView] style reload failed (${reason})`, error);
      }
    };

    // ── Failure handling (defect B2) ──────────────────────────────────────
    //
    // MapLibre fires `error` for every 404 tile and every request aborted by
    // a pan. `map-error-policy.ts` decides what is style-level and how many
    // consecutive failures justify saying anything; the raw event is always
    // logged so a browser-console screenshot can still name what failed.
    const clearStyleResetTimer = () => {
      if (styleResetTimerRef.current !== null) {
        clearTimeout(styleResetTimerRef.current);
        styleResetTimerRef.current = null;
      }
    };

    /** Re-set the style on a bounded backoff — the "retrying…" in the copy. */
    const scheduleStyleReset = () => {
      if (styleResetTimerRef.current !== null) return;
      const delay = STYLE_RESET_DELAYS_MS[styleResetsRef.current];
      if (delay === undefined) return; // budget spent; the notice goes terminal
      styleResetsRef.current += 1;
      styleResetTimerRef.current = setTimeout(() => {
        styleResetTimerRef.current = null;
        reloadStyle('backoff');
      }, delay);
    };

    const onMapErrorEvent = (event: unknown) => {
      // Raw, untruncated, for diagnostics — independent of what we show.
      console.error('[MapView] map error', event);
      const notice = errorTrackerRef.current.record(event, Date.now());
      publishNotice(notice);
      if (notice.kind === 'retrying') scheduleStyleReset();
    };
    map.on('error', onMapErrorEvent as never);

    /**
     * Anything that proves the map is rendering again clears the notice —
     * automatically, with no restart and no "Retry map" tap. `idle` fires
     * once the viewport is fully drawn; `styledata` fires as soon as a style
     * (including a re-set one) parses.
     */
    const onMapRecovered = () => {
      clearStyleResetTimer();
      styleResetsRef.current = 0;
      publishNotice(errorTrackerRef.current.recover());
    };
    map.on('idle', onMapRecovered as never);
    map.on('styledata', onMapRecovered as never);

    /**
     * The network came back. The browser tells us directly, so the map does
     * not have to wait for a user gesture: re-set the style and let
     * `styledata` / `idle` clear the notice.
     */
    const onOnline = () => {
      clearStyleResetTimer();
      styleResetsRef.current = 0;
      errorTrackerRef.current.recover();
      reloadStyle('online');
    };
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

    // Gesture detection via originalEvent (MapLibre's documented signal)
    const onMoveStart = (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      // originalEvent is present only for user gestures
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatchRef.current({ type: 'user-gesture' });
      }
    };

    map.on('movestart', onMoveStart as never);
    map.on('dragstart', () => dispatchRef.current({ type: 'user-gesture' }));
    map.on('zoomstart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatchRef.current({ type: 'user-gesture' });
      }
    });
    map.on('rotatestart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatchRef.current({ type: 'user-gesture' });
      }
    });
    map.on('pitchstart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatchRef.current({ type: 'user-gesture' });
      }
    });

    /**
     * Sources and layers the overlays write into.
     *
     * Idempotent, and re-runnable: a `setStyle()` re-set clears
     * `overlaysInstalled`, so this runs again on the next `styledata` — not
     * only on the one-shot `load` event.
     */
    const installOverlayLayers = (): boolean => {
      if (overlaysInstalled) return true;
      if (!map.isStyleLoaded()) return false;

      // Planned route line (straight stop-to-stop — the copy says so).
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
        });
      }
      if (!map.getLayer('sbt-route-line')) {
        map.addLayer({
          id: 'sbt-route-line',
          type: 'line',
          source: ROUTE_SOURCE_ID,
          paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.55 },
        });
      }

      // Driven-path line (crew console). Drawn after the planned route line
      // so the real path reads above the straight plan.
      if (!map.getSource(TRAIL_SOURCE_ID)) {
        map.addSource(TRAIL_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
        });
      }
      if (!map.getLayer('sbt-trail-line')) {
        map.addLayer({
          id: 'sbt-trail-line',
          type: 'line',
          source: TRAIL_SOURCE_ID,
          paint: { 'line-color': '#16a34a', 'line-width': 3, 'line-opacity': 0.85 },
        });
      }

      // Accuracy ring.
      if (!map.getSource(ACCURACY_SOURCE_ID)) {
        map.addSource(ACCURACY_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer('sbt-accuracy-fill')) {
        map.addLayer({
          id: 'sbt-accuracy-fill',
          type: 'fill',
          source: ACCURACY_SOURCE_ID,
          paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.13 },
        });
      }
      if (!map.getLayer('sbt-accuracy-stroke')) {
        map.addLayer({
          id: 'sbt-accuracy-stroke',
          type: 'line',
          source: ACCURACY_SOURCE_ID,
          paint: { 'line-color': '#f59e0b', 'line-width': 1 },
        });
      }

      overlaysInstalled = true;
      return true;
    };

    /**
     * The map is ready (defect A).
     *
     * `mapReadyRef` is written first so the sync below lands in this same
     * tick; `setMapReady(true)` is the React-visible half that makes every
     * overlay effect re-run — which is what the bus marker was missing when
     * the map was created *after* the first fix.
     */
    const onStyleReady = () => {
      if (!installOverlayLayers()) return;
      mapReadyRef.current = true;
      setMapReady(true);
      // The initial fit is NOT dispatched from here: this closure is created
      // once and would fit yesterday's stops. `syncOverlays` asks for it the
      // moment it creates the bus, and the `mapReady`-gated fit effect covers
      // a stops-only trip with the data of the render it runs in.
      syncOverlaysRef.current();
    };

    map.on('load', onStyleReady);
    map.on('styledata', onStyleReady as never);
    map.on('idle', onStyleReady as never);
    map.on('idle', onMapRecovered as never);
    map.on('styledata', onMapRecovered as never);

    return () => {
      clearStyleResetTimer();
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      map.off('movestart', onMoveStart as never);
      map.off('error', onMapErrorEvent as never);
      map.off('load', onStyleReady);
      map.off('styledata', onStyleReady as never);
      map.off('idle', onStyleReady as never);
      map.off('idle', onMapRecovered as never);
      map.off('styledata', onMapRecovered as never);
      stopLoop();
      map.remove();
      mapRef.current = null;
      busMarkerRef.current = null;
      busElementRef.current = null;
      busPopupRef.current = null;
      // The engine took every marker with it; drop the dead handles so the
      // next map starts from nothing.
      overlaysRef.current.reset();
      mapReadyRef.current = false;
      setMapReady(false);
    };
    // Run once when webglSupported becomes true — the overlay data is read
    // through `syncOverlaysRef`, so re-creating the map on every stop change
    // would be wrong. `hasAnything` MUST be here: the empty state renders no
    // container div, so when the first datum (stops or fix) arrives after
    // mount the effect has to re-run — with `[webglSupported]` alone the
    // container appeared but the map never initialised, leaving a dead map
    // box on the admin trip page.
  }, [webglSupported, hasAnything, styleUrl, stopLoop, publishNotice]);

  /**
   * Route line, driven-path line, accuracy ring and stop markers — every
   * overlay that is pure data, written by the one `syncOverlays()` routine.
   *
   * `mapReady` is in the dependency array on purpose (defect A): when the
   * data lands before the map exists, this effect runs again the moment the
   * map is ready and writes what is true *then*. No early return can swallow
   * an update any more, because readiness is an input.
   */
  useEffect(() => {
    if (!mapReady) return;
    syncOverlays();
  }, [mapReady, syncOverlays]);

  /**
   * Bus marker + motion machine.
   *
   * The marker itself is created by `syncOverlays()` above; what stays here
   * is everything the overlay writer must not know about — the popup copy and
   * the interpolation machine. `mapReady` is in the deps for the same reason:
   * the marker used to be created by an effect keyed only on `fix`, so a map
   * built *after* the REST snapshot resolved never got a bus at all.
   */
  useEffect(() => {
    if (!mapReady) return;
    syncOverlays();

    if (!fix) {
      motionRef.current.reset();
      renderedRef.current = null;
      return;
    }

    // Update popup content
    if (busPopupRef.current) {
      const showSpeed = presentation.animate && fix.speed !== null;
      const html = `
        <strong>${escapeHtml(APP_CONFIG.appName)}</strong>
        <div>${presentation.animate ? `Updated ${escapeHtml(formatRelative(fix.received_at))}` : `Last known ${escapeHtml(formatTime(fix.recorded_at))}`}</div>
        <div>${showSpeed ? escapeHtml(formatSpeedKmh(fix.speed)) : 'Speed not reported'}</div>
        ${fix.accuracy !== null && fix.accuracy > 50 ? `<div>Position approximate (±${Math.round(fix.accuracy)} m)</div>` : ''}
      `;
      busPopupRef.current.setHTML(html);
    }

    // Push into motion machine
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
    applyFrame(now);
    if (outcome.action === 'animated') startLoop();
  }, [mapReady, syncOverlays, fix, presentation.animate, applyFrame, startLoop]);

  // Freshness handling: halt/resume animation
  useEffect(() => {
    if (presentation.animate) {
      motionRef.current.resume();
      if (motionRef.current.isAnimating()) startLoop();
    } else {
      motionRef.current.halt();
      stopLoop();
      applyFrame(nowMs());
    }
  }, [presentation.animate, applyFrame, startLoop, stopLoop]);

  // Foreground resume + background pause
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        dispatch({ type: 'resumed' });
        applyFrame(nowMs());
        if (motionRef.current.isAnimating()) startLoop();
        return;
      }
      motionRef.current.cancelAnimation();
      stopLoop();
      applyFrame(nowMs());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [dispatch, applyFrame, startLoop, stopLoop]);

  /**
   * Fit once per trip when data becomes available (stops or fix).
   *
   * `mapReady` gates this too, and it is load-bearing rather than tidy:
   * `data-available` flips `hasFitted` to true whether or not a camera was
   * there to move. Dispatched before the map existed, it would burn the one
   * fit this trip gets — leaving the bus correctly drawn but off-screen,
   * which is the same bug wearing a different hat.
   */
  useEffect(() => {
    if (!mapReady) return;
    if (mappedStops.length > 0 || fix) {
      dispatch({ type: 'data-available' });
    }
  }, [mapReady, dispatch, mappedStops.length, fix]);

  useEffect(() => {
    if (!mapReady) return;
    if (fix) dispatch({ type: 'fix-arrived' });
  }, [mapReady, dispatch, fix]);

  // Trip switch cleanup (when fix is null or component unmounts)
  useEffect(() => {
    return () => {
      motionRef.current.cancelAnimation();
      stopLoop();
    };
  }, [stopLoop]);

  if (!hasAnything) {
    return (
      <div className="map-shell">
        <div className="empty">
          <p className="muted">No GPS position or mapped stops for this trip yet.</p>
        </div>
      </div>
    );
  }

  if (webglSupported === false) {
    return (
      <div className="map-shell">
        <div className="empty">
          <p className="muted">
            Map unavailable — your browser does not support WebGL, which MapLibre needs to render
            vector tiles. Markers and status are still available below.
          </p>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Attribution: OpenFreeMap © OpenMapTiles, Data from OpenStreetMap
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', minHeight: '420px' }}
        role="region"
        aria-label="Live bus map"
      />
      <div className="map-camera-controls">
        {controls ? (
          <button
            type="button"
            className="map-follow-control"
            onClick={() => fitRouteRef.current?.()}
            aria-label={controls.fitRouteLabel}
          >
            {controls.fitRouteLabel}
          </button>
        ) : null}
        {exploring ? (
          <button
            type="button"
            className="map-follow-control"
            onClick={() => recenterRef.current?.()}
            aria-label={controls?.followBusLabel ?? 'Follow bus'}
          >
            {controls?.followBusLabel ?? 'Follow bus'}
          </button>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {exploring ? 'Map exploration — follow paused' : 'Following the bus'}
      </span>
    </div>
  );
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
