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
  connection = 'offline',
  onMapError,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const [exploring, setExploring] = useState(false);
  const [tick, setTick] = useState(0);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const busMarkerRef = useRef<maplibregl.Marker | null>(null);
  const busElementRef = useRef<HTMLDivElement | null>(null);
  const busPopupRef = useRef<maplibregl.Popup | null>(null);
  // 3E speed: keep stop markers by id so we don't recreate all on highlight change.
  const stopMarkersRef = useRef<Map<string, { marker: maplibregl.Marker; element: HTMLDivElement }>>(
    new Map(),
  );
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

  // Expose recenter and pan for button and frame loop
  useEffect(() => {
    recenterRef.current = () => dispatch({ type: 'recenter' });
    return () => {
      recenterRef.current = null;
    };
  }, [dispatch]);

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

    const styleUrl = resolveMapStyleUrl({
      NEXT_PUBLIC_MAP_STYLE_URL: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
    });

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
      // Never fail silently: the caller shows "Map failed to load".
      console.error('[MapView] map initialization failed', error);
      onMapErrorRef.current?.('Map failed to load');
      return;
    }

    mapRef.current = map;

    // Style/tile/glyph failures and WebGL context loss surface here — they
    // must never leave a silent blank map box.
    const onMapErrorEvent = (event: unknown) => {
      const message = (event as { error?: { message?: string } })?.error?.message ?? 'map error';
      console.error('[MapView]', message);
      onMapErrorRef.current?.('Map failed to load');
    };
    map.on('error', onMapErrorEvent as never);

    // Gesture detection via originalEvent (MapLibre's documented signal)
    const onMoveStart = (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      // originalEvent is present only for user gestures
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatch({ type: 'user-gesture' });
      }
    };

    map.on('movestart', onMoveStart as never);
    map.on('dragstart', () => dispatch({ type: 'user-gesture' }));
    map.on('zoomstart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatch({ type: 'user-gesture' });
      }
    });
    map.on('rotatestart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatch({ type: 'user-gesture' });
      }
    });
    map.on('pitchstart', (e: maplibregl.MapLibreEvent & { originalEvent?: unknown }) => {
      if ((e as { originalEvent?: unknown }).originalEvent) {
        dispatch({ type: 'user-gesture' });
      }
    });

    map.on('load', () => {
      // Route line source + layer
      if (!map.getSource('sbt-route')) {
        map.addSource('sbt-route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: lineCoords.length >= 2 ? lineCoords : [],
            },
          },
        });
      }
      if (!map.getLayer('sbt-route-line')) {
        map.addLayer({
          id: 'sbt-route-line',
          type: 'line',
          source: 'sbt-route',
          paint: {
            'line-color': '#2563eb',
            'line-width': 4,
            'line-opacity': 0.55,
          },
        });
      }

      // Accuracy circle source + layers
      if (!map.getSource('sbt-accuracy')) {
        map.addSource('sbt-accuracy', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });
      }
      if (!map.getLayer('sbt-accuracy-fill')) {
        map.addLayer({
          id: 'sbt-accuracy-fill',
          type: 'fill',
          source: 'sbt-accuracy',
          paint: {
            'fill-color': '#f59e0b',
            'fill-opacity': 0.13,
          },
        });
      }
      if (!map.getLayer('sbt-accuracy-stroke')) {
        map.addLayer({
          id: 'sbt-accuracy-stroke',
          type: 'line',
          source: 'sbt-accuracy',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 1,
          },
        });
      }

      // Initial fit once per trip
      if (mappedStops.length > 0 || fixRef.current) {
        dispatch({ type: 'data-available' });
      }
    });

    return () => {
      map.off('movestart', onMoveStart as never);
      map.off('error', onMapErrorEvent as never);
      stopLoop();
      map.remove();
      mapRef.current = null;
      busMarkerRef.current = null;
      busElementRef.current = null;
      busPopupRef.current = null;
      for (const { marker } of stopMarkersRef.current.values()) {
        marker.remove();
      }
      stopMarkersRef.current.clear();
    };
    // Run once when webglSupported becomes true — lineCoords/mappedStops are
    // read inside the load handler via dispatch/fitToData and re-creating the
    // map on every stop change would be wrong. `hasAnything` MUST be here:
    // the empty state renders no container div, so when the first datum
    // (stops or fix) arrives after mount the effect has to re-run — with
    // `[webglSupported]` alone the container appeared but the map never
    // initialised, leaving a dead map box on the admin trip page.
  }, [webglSupported, hasAnything]);

  // Update route line when stops change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('sbt-route') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: lineCoords.length >= 2 ? lineCoords : [],
      },
    });
  }, [lineCoords]);

  // Update accuracy circle when fix or presentation changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource('sbt-accuracy') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (fix && presentation.accuracyCircleMeters !== null) {
      const polygon = accuracyCirclePolygon(
        { latitude: fix.latitude, longitude: fix.longitude },
        presentation.accuracyCircleMeters,
      );
      source.setData({
        type: 'FeatureCollection',
        features: [polygon],
      });
    } else {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
  }, [fix, presentation.accuracyCircleMeters]);

  // Stop markers — diff by id, avoid full recreate on highlight change (3E speed).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existing = stopMarkersRef.current;
    const nextIds = new Set(mappedStops.map((s) => s.id));

    // Remove markers for stops that no longer exist.
    for (const [id, entry] of existing) {
      if (!nextIds.has(id)) {
        entry.marker.remove();
        existing.delete(id);
      }
    }

    // Add or update markers.
    for (const stop of mappedStops) {
      const kind = highlightStopId === stop.id ? 'current' : 'plain';
      const entry = existing.get(stop.id);
      if (entry) {
        // Update position if changed (cheap) and kind class.
        entry.marker.setLngLat([stop.longitude, stop.latitude]);
        const el = entry.element;
        // Keep label text in sync if sequence/name changed.
        const labelSpan = el.querySelector('.stop-marker-label') as HTMLSpanElement | null;
        const expectedLabel = `${stop.sequence_number}. ${stop.name}`;
        if (labelSpan && labelSpan.textContent !== expectedLabel) {
          labelSpan.textContent = expectedLabel;
        }
        // Update first text node (sequence number) and class.
        if (el.firstChild && el.firstChild.nodeType === 3) {
          const seqText = String(stop.sequence_number);
          if (el.firstChild.textContent !== seqText) el.firstChild.textContent = seqText;
        } else {
          // Fallback: recreate if structure unexpected.
          el.textContent = String(stop.sequence_number);
          const lbl = document.createElement('span');
          lbl.className = 'stop-marker-label';
          lbl.textContent = expectedLabel;
          el.appendChild(lbl);
        }
        el.className = `stop-marker ${kind}`;
        continue;
      }

      const el = createStopMarkerElement(stop.sequence_number, kind as 'plain' | 'current', stop.name);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(map);

      const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<strong>Stop ${stop.sequence_number}: ${escapeHtml(stop.name)}</strong>${
          stop.address ? `<div>${escapeHtml(stop.address)}</div>` : ''
        }`,
      );
      marker.setPopup(popup);
      existing.set(stop.id, { marker, element: el });
    }
  }, [mappedStops, highlightStopId]);

  // Highlight-only update: when only highlightStopId changes, avoid re-diffing all stops
  // by just toggling the class on the two affected markers. The main effect above already
  // handles highlight, but this extra effect ensures we don't re-create popups.
  useEffect(() => {
    for (const [id, entry] of stopMarkersRef.current) {
      const shouldBeCurrent = id === highlightStopId;
      const isCurrent = entry.element.classList.contains('current');
      if (shouldBeCurrent !== isCurrent) {
        entry.element.className = `stop-marker ${shouldBeCurrent ? 'current' : 'plain'}`;
      }
    }
  }, [highlightStopId]);

  // Bus marker creation / fix handling (motion machine)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!fix) {
      // Remove bus marker if fix disappears
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      busElementRef.current = null;
      busPopupRef.current = null;
      motionRef.current.reset();
      renderedRef.current = null;
      return;
    }

    if (!busMarkerRef.current) {
      const el = createBusMarkerElement();
      busElementRef.current = el;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([fix.longitude, fix.latitude])
        .addTo(map);
      busMarkerRef.current = marker;

      const popup = new maplibregl.Popup({ offset: 24, closeButton: true });
      busPopupRef.current = popup;
      marker.setPopup(popup);
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
  }, [fix, presentation.animate, applyFrame, startLoop]);

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

  // Fit once per trip when data becomes available (stops or fix)
  useEffect(() => {
    if (mappedStops.length > 0 || fix) {
      dispatch({ type: 'data-available' });
    }
  }, [dispatch, mappedStops.length, fix]);

  useEffect(() => {
    if (fix) dispatch({ type: 'fix-arrived' });
  }, [dispatch, fix]);

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
