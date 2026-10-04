'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { APP_CONFIG } from '@school-bus-tracking/config';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import type { MapViewProps } from './types';
import {
  BUS_MARKER_ART_ID,
  BUS_MARKER_BOX,
  BUS_MARKER_DEFS_SVG,
  BUS_MARKER_SHADOW_ID,
  MAP_3D_PITCH,
  MAP_3D_SKY,
  MAP_BUILDING_LAYER_ID,
  MAP_MAX_PITCH,
  type MapDimension,
  type MapFallbackReason,
} from '@school-bus-tracking/map-assets';
import {
  setBusIconHeading,
  setBusMarkerVisualState,
  type BusMarkerVisualState,
} from './bus-marker-icon';
import { FRAME_MIN_INTERVAL_MS, MOTION_THRESHOLDS, createBusMotion } from './bus-motion';
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
import { canSyncOverlays, syncBusMarker as reconcileBusMarker } from './map-overlays';
import {
  BUS_3D_LAYER_ID,
  BUS_3D_SOURCE_ID,
  EMPTY_BUS_MESH,
  buildingsLayerForDimension,
  buildingsLayerVisible,
  busExtrusionLayer,
  busMeshCollection,
} from './bus-3d';
import { simplifyPolylineMeters, TRAIL_SIMPLIFY_TOLERANCE_METERS } from './polyline-simplify';
import {
  BUS_DOM_MARKER_LAYER_ID,
  POI_LAYER_ID,
  mapTapQueryLayerIds,
  resolveMapTap,
  type PoiTapInfo,
  type TappedFeature,
} from './poi-sheet';
import { stopsLayerCollection } from './stop-layer';
import { chooseRouteLine } from './route-geometry';
import { useAuth } from '../auth/AuthProvider';
import { useMapCameraMode } from './useMapCameraMode';
import {
  INITIAL_MAP_ERROR_STATE,
  classifyMapErrorEvent,
  clearMapError,
  describeMapError,
  mapNoticeMessage,
  recordMapError,
  type MapErrorState,
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

function fallbackNoticeMessage(reason: MapFallbackReason): string {
  return reason === 'reduced-motion'
    ? '3D view is off because Reduce Motion is enabled.'
    : '3D view was turned off to keep the map smooth.';
}

/**
 * Every app layer, in the order they must be drawn. Used to put them back on
 * top after the 3D building extrusion is inserted into the base style: the
 * extrusion goes *below* the style's first symbol layer, and MapLibre draws
 * in layer order, so the stops/route/bus must sit above it or the 3D view can
 * bury them under the buildings.
 */
const APP_LAYER_ORDER = [
  'sbt-route-casing',
  'sbt-route-line',
  'sbt-trail-line',
  'sbt-accuracy-fill',
  'sbt-accuracy-stroke',
  'sbt-stops-dot',
  'sbt-stops-number',
  'sbt-stops-label',
  BUS_3D_LAYER_ID,
];

function raiseAppLayers(map: maplibregl.Map): void {
  for (const id of APP_LAYER_ORDER) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/**
 * Add/remove presentation only; never add or replace an OpenFreeMap source.
 *
 * The "is the buildings layer on?" decision lives in `bus-3d.ts`
 * (`buildingsLayerVisible`, spec'd in `bus-3d-buildings.spec.ts`) — this
 * function only applies it: sky + extrusion while the 3D camera owns the map,
 * the untouched base style in 2D.
 */
function applyMapDimension(
  map: maplibregl.Map,
  dimension: MapDimension,
  originalSky: unknown,
): void {
  map.setMaxPitch(MAP_MAX_PITCH);
  const setSky = map.setSky.bind(map) as (sky?: unknown) => unknown;
  if (buildingsLayerVisible(dimension)) {
    setSky(MAP_3D_SKY);
    if (!map.getLayer(MAP_BUILDING_LAYER_ID)) {
      const layer = buildingsLayerForDimension(map.getStyle(), dimension);
      if (layer) {
        const before = map.getStyle().layers.find((candidate) => candidate.type === 'symbol')?.id;
        map.addLayer(layer as unknown as maplibregl.LayerSpecification, before);
      }
    }
    raiseAppLayers(map);
    return;
  }
  if (map.getLayer(MAP_BUILDING_LAYER_ID)) map.removeLayer(MAP_BUILDING_LAYER_ID);
  setSky(originalSky);
}

type LatLngTuple = [number, number];

interface RenderedMarker {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgUse(symbolId: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.append(use);
  return svg;
}

/**
 * Builds only lightweight wrapper nodes. The detailed art is not parsed here:
 * it lives once in the map shell's `<defs>`, and every marker references those
 * shared symbols with `<use>`.
 */
function createBusMarkerElement(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'bus-marker';
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = `width:0;height:0;overflow:visible;--sbt-bus-width:${BUS_MARKER_BOX.width}px;--sbt-bus-height:${BUS_MARKER_BOX.height}px;--sbt-bus-rotation-box:${BUS_MARKER_BOX.rotationBox}px;`;

  const anchor = document.createElement('div');
  anchor.className = 'bus-marker-anchor';
  const shadow = svgUse(BUS_MARKER_SHADOW_ID, 'bus-marker-shadow');
  const halo = document.createElement('div');
  halo.className = 'bus-marker-halo';
  const rotor = document.createElement('div');
  rotor.className = 'bus-marker-rotor';
  const cone = document.createElement('div');
  cone.className = 'bus-marker-heading-cone';
  const art = svgUse(BUS_MARKER_ART_ID, 'bus-marker-art');

  rotor.append(cone, art);
  anchor.append(shadow, halo, rotor);
  container.append(anchor);
  return container;
}

export const MapViewInner: React.FC<MapViewProps> = ({
  fix,
  stops = [],
  roadGeometry = null,
  highlightStopId = null,
  nextStopId = null,
  trail,
  controls,
  connection = 'offline',
  onMapError,
  onMapNotice,
}) => {
  const reducedMotion = usePrefersReducedMotion();
  const { user } = useAuth();
  const { dimension, threeDUnavailable, fallbackNotice, setPreferredDimension, recordRenderFrame } =
    useMapCameraMode({
      userId: user?.id ?? null,
      role: user?.role ?? null,
      reducedMotion,
    });
  const [exploring, setExploring] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  // The POI tap sheet: ONLY driven by taps (never per-frame), reading the
  // already-rendered vector-tile feature — see `poi-sheet.ts`. Null = closed.
  const [poiSheet, setPoiSheet] = useState<PoiTapInfo | null>(null);
  const [tick, setTick] = useState(0);
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  // Explicit map-readiness signal. The map is created by an effect gated on
  // [webglSupported, mapWanted]; every *other* effect that mutates the map
  // imperatively depends on this flag, so overlays are re-applied whenever the
  // map appears — including when it appears *after* the data did. Without it,
  // a trip whose only fix came from the REST snapshot never got a bus marker.
  const [mapReady, setMapReady] = useState(false);
  /**
   * One-way latch on `hasAnything`: the map is wanted the moment the first
   * datum (stops or a fix) appears, and stays wanted forever after. This is
   * what lets the map be created ONCE while preserving the PR #192 guarantee
   * — see the dependency-array note on the map-init effect below.
   */
  const [mapWanted, setMapWanted] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originalSkyRef = useRef<unknown>(undefined);
  const dimensionRef = useRef(dimension);
  dimensionRef.current = dimension;
  const recordRenderFrameRef = useRef(recordRenderFrame);
  recordRenderFrameRef.current = recordRenderFrame;
  const busMarkerRef = useRef<maplibregl.Marker | null>(null);
  const busElementRef = useRef<HTMLDivElement | null>(null);
  const busPopupRef = useRef<maplibregl.Popup | null>(null);
  // The frame loop reads this ref so a heading update can change only marker
  // classes — not React state — for live/stale, cone and pulse presentation.
  const busVisualStateRef = useRef<BusMarkerVisualState>({
    live: false,
    moving: false,
    reducedMotion: false,
  });
  // The one stop-layer popup, re-used per click (the stop layers are canvas
  // layers now — the popup is the click affordance, the label is the reading
  // affordance; see `stop-layer.ts`).
  const stopPopupRef = useRef<maplibregl.Popup | null>(null);
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
  const onMapNoticeRef = useRef(onMapNotice);
  onMapNoticeRef.current = onMapNotice;
  // Mirror of `mapReady` for the imperative helpers (they run inside MapLibre
  // callbacks where the state value captured at render time may be stale).
  const mapReadyRef = useRef(false);
  mapReadyRef.current = mapReady;
  // Identity of the last fix handed to the motion machine, so re-running the
  // overlay sync for an unrelated reason cannot double-push a sample.
  const lastPushedFixRef = useRef<typeof fix>(null);
  // Set by the map-init effect so `map.on('load')` can sync overlays without
  // depending on a callback that did not exist when the map was created.
  const syncOverlaysRef = useRef<(() => void) | null>(null);
  // Rebuilds the extruded 3D bus mesh from the last rendered position. Held
  // in a ref so MapLibre's own `zoom` event can re-scale the vehicle without
  // the map effect depending on React state.
  const busMeshSyncRef = useRef<(() => void) | null>(null);
  // Rolling window of recent map failures. A ref, not state: MapLibre can fire
  // dozens of error events per second during a bad pan and none of them should
  // cost a render unless the user-visible notice actually changes.
  const mapErrorStateRef = useRef<MapErrorState>(INITIAL_MAP_ERROR_STATE);

  const mappedStops = useMemo(
    () =>
      stops.filter(
        (stop): stop is StopResponse & { latitude: number; longitude: number } =>
          stop.latitude != null && stop.longitude != null,
      ),
    [stops],
  );

  const routeLine = useMemo(
    () => chooseRouteLine({ roadGeometry, stops }),
    [roadGeometry, stops],
  );
  const lineCoords = routeLine?.line.coordinates ?? [];

  // Driven-path breadcrumb (crew console). GeoJSON expects [lng, lat].
  const trailCoords = useMemo(
    () =>
      (trail ?? [])
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .map((point) => [point.longitude, point.latitude] as [number, number]),
    [trail],
  );

  // The trail as it is actually written to the source: decimated
  // (Douglas–Peucker, ~5 m) first. The raw breadcrumb of a two-hour trip is
  // ~1,800 mostly-jitter points, and `syncTrailLine` re-sets the whole line
  // on every fix — the decimated subset is what the source re-tessellates.
  const decimatedTrailCoords = useMemo(
    () => simplifyPolylineMeters(trailCoords, TRAIL_SIMPLIFY_TOLERANCE_METERS),
    [trailCoords],
  );

  // The stops as ONE layer: a single GeoJSON collection for the `sbt-stops`
  // source, with the highlight (next stop / the parent's home stop) carried
  // as a data-driven `kind` property instead of N DOM markers.
  const stopsCollection = useMemo(
    () => stopsLayerCollection(mappedStops, highlightStopId, nextStopId),
    [mappedStops, highlightStopId, nextStopId],
  );

  // Declared before the map-init effect: its deps gate map creation. The
  // container div is always mounted (see the render), but the map itself is
  // only wanted once there is something to show — the `mapWanted` latch
  // below carries that decision to the map-init effect exactly once.
  const hasAnything = mappedStops.length > 0 || fix !== null;

  // The latch: flips to true the first time there is anything to draw and
  // never back. `hasAnything` itself may flip repeatedly (a fix going null
  // during a trip switch, the next trip's stops still loading) — the map
  // must not be torn down and re-created on those flips.
  useEffect(() => {
    if (hasAnything) setMapWanted(true);
  }, [hasAnything]);

  // The container's *visibility* (never its layout) flips with `hasAnything`;
  // `resize()` is a no-op when nothing changed and a reconciliation if the
  // browser did something unexpected while it was hidden.
  useEffect(() => {
    if (hasAnything) mapRef.current?.resize();
  }, [hasAnything]);

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

  // State is deliberately derived from freshness and the one shared motion
  // threshold. A tween ending does not turn a live, driving bus into stopped.
  busVisualStateRef.current = {
    live: presentation.animate,
    moving:
      presentation.animate &&
      fix?.speed !== null &&
      fix?.speed !== undefined &&
      fix.speed >= MOTION_THRESHOLDS.headingMinSpeedKmh,
    reducedMotion,
  };

  // Freshness aging tick
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  // POI tap sheet: Escape dismisses (the outside-tap path is the map click
  // handler in installOverlays). The listener exists only while a sheet is
  // actually open.
  useEffect(() => {
    if (!poiSheet) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPoiSheet(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [poiSheet]);

  // Reduced motion live update
  useEffect(() => {
    motionRef.current.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    onMapNoticeRef.current?.(fallbackNotice ? fallbackNoticeMessage(fallbackNotice) : null);
  }, [fallbackNotice]);

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

  /**
   * Put the bus on the map at one rendered position.
   *
   * There are two representations and exactly one is ever visible:
   *
   * - **2D camera** — the existing flat DOM marker (unchanged).
   * - **3D camera** — the extruded mesh in `sbt-bus-3d` (see `bus-3d.ts`),
   *   with the DOM marker hidden. A DOM marker is viewport-aligned, so in a
   *   pitched scene it is a billboard standing up in front of the map: that
   *   is the "flat sticker" the 3D view was reported as, and no amount of CSS
   *   can make an HTML element a solid object inside the WebGL scene.
   *
   * Called from the animation frame loop, so the mesh follows the same
   * interpolated position the marker does — smooth between GPS fixes, always
   * ending on a real fix (`bus-motion.ts` never extrapolates).
   */
  const paintBus = useCallback((rendered: RenderedMarker | null) => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const element = busElementRef.current;
    const source = map.getSource(BUS_3D_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    const mesh =
      source && dimensionRef.current === '3d' && rendered
        ? busMeshCollection({
            latitude: rendered.latitude,
            longitude: rendered.longitude,
            headingDeg: rendered.headingDeg,
            zoom: map.getZoom(),
            stale: !busVisualStateRef.current.live,
          })
        : null;
    // The flat marker steps aside only once there is a solid mesh to replace
    // it with. If the 3D source is missing for any reason, the bus is still
    // on the map — "no bus at all" is never an outcome of this function.
    if (element) element.classList.toggle('is-hidden-by-3d-bus', mesh !== null);
    source?.setData(mesh ?? EMPTY_BUS_MESH);
  }, []);

  useEffect(() => {
    busMeshSyncRef.current = () => paintBus(renderedRef.current);
    return () => {
      busMeshSyncRef.current = null;
    };
  }, [paintBus]);

  const applyFrame = useCallback(
    (now: number) => {
      const rendered = motionRef.current.sample(now);
      if (!rendered) return;
      const lngLat: [number, number] = [rendered.longitude, rendered.latitude];
      busMarkerRef.current?.setLngLat(lngLat);
      if (busElementRef.current) {
        setBusIconHeading(busElementRef.current, rendered.headingDeg);
        setBusMarkerVisualState(busElementRef.current, {
          ...busVisualStateRef.current,
          moving: busVisualStateRef.current.moving && rendered.headingDeg !== null,
        });
      }
      renderedRef.current = {
        latitude: rendered.latitude,
        longitude: rendered.longitude,
        headingDeg: rendered.headingDeg,
      };
      // The solid 3D vehicle rides the same interpolated position/heading.
      paintBus(renderedRef.current);
      // Imperative camera follow hook
      if (followRef.current.mode === 'following') {
        panRef.current?.(FOLLOW_CAMERA_THROTTLE_MS + 50, false);
      }
    },
    [paintBus],
  );

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

  // "Fit route": fit the bounds and hand the camera to the user — entering
  // explore mode keeps the next GPS fix from panning the freshly fitted view
  // away; "Follow bus" hands it back. Default-on for every role; the `controls`
  // prop only overrides the labels.
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

  /**
   * Push a new error state out to the caller, but only when the *notice*
   * changed. `onMapError(null)` is the clear signal, which is how the badge
   * disappears by itself once the map starts drawing again.
   */
  const applyMapErrorState = useCallback((next: MapErrorState) => {
    const previous = mapErrorStateRef.current;
    mapErrorStateRef.current = next;
    if (previous.notice === next.notice) return;
    onMapErrorRef.current?.(mapNoticeMessage(next.notice));
  }, []);

  // Map initialization
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;
    if (webglSupported === false) return;
    if (webglSupported === null) return; // wait for check
    if (!mapWanted) return; // nothing to draw yet — see the latch above

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
        pitch: dimensionRef.current === '3d' ? MAP_3D_PITCH : 0,
        maxPitch: MAP_MAX_PITCH,
        dragRotate: user?.role !== 'DRIVER',
        touchPitch: user?.role !== 'DRIVER' && dimensionRef.current === '3d',
        attributionControl: { compact: false },
      });
      if (user?.role === 'DRIVER') map.touchZoomRotate.disableRotation();
    } catch (error) {
      // A constructor throw is terminal — there is no map object to retry
      // with — so it skips the threshold and says so outright.
      console.error('[MapView] map initialization failed', error);
      applyMapErrorState(recordMapError(INITIAL_MAP_ERROR_STATE, 'fatal', nowMs()));
      return;
    }

    mapRef.current = map;

    // Engine chrome, same for every role: zoom + compass and fullscreen.
    // Placement is deliberate — the bottom corners stay reserved for provider
    // attribution/logo, while every app and engine control stays top/right.
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(
      new maplibregl.FullscreenControl({ container: shellRef.current ?? undefined }),
      'top-right',
    );

    // Style/tile/glyph failures and WebGL context loss arrive here. MapLibre
    // fires this for every 404 tile and every request cancelled by a pan, so
    // the event is *classified* and *counted* rather than reported: only a
    // run of style-level failures ever reaches the user. The raw code is
    // always logged, so a field screenshot of the console still names what
    // failed.
    const onMapErrorEvent = (event: unknown) => {
      const kind = classifyMapErrorEvent(event, styleUrl);
      console[kind === 'source' || kind === 'abort' ? 'warn' : 'error'](
        `[MapView] ${kind}: ${describeMapError(event)}`,
      );
      applyMapErrorState(recordMapError(mapErrorStateRef.current, kind, nowMs()));
    };
    map.on('error', onMapErrorEvent as never);

    // The map drew something. Whatever was failing has stopped failing, so
    // the notice clears itself — no restart, no "Retry map" tap.
    const onMapHealthy = () => {
      applyMapErrorState(clearMapError(mapErrorStateRef.current));
    };
    const onStyleData = () => {
      if (map.isStyleLoaded()) onMapHealthy();
    };
    map.on('idle', onMapHealthy as never);
    map.on('styledata', onStyleData as never);

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
    map.on('render', () => recordRenderFrameRef.current(nowMs()));

    /**
     * Create every app source/layer. Idempotent (every step is guarded by a
     * `getSource`/`getLayer` check) so it can run again whenever the style
     * reloads.
     *
     * It is deliberately NOT responsible for the 3D camera presentation any
     * more. Sky/building-extrusion application used to be the first statement
     * of the `load` handler, which made the whole overlay set — the route, the
     * accuracy ring, the STOPS and the readiness flag the bus marker waits on
     * — hostage to it: one throw there and nothing below ever ran, so the map
     * showed tiles and nothing else. Presentation now runs last, in its own
     * try/catch, after the overlays and after `mapReady`.
     */
    let overlayHandlersBound = false;
    const installOverlays = () => {
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
      if (!map.getLayer('sbt-route-casing')) {
        map.addLayer({
          id: 'sbt-route-casing',
          type: 'line',
          source: 'sbt-route',
          layout: {
            visibility: routeLine?.kind === 'road' ? 'visible' : 'none',
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#172554',
            'line-width': 8,
            'line-opacity': 0.72,
          },
        });
      }
      if (!map.getLayer('sbt-route-line')) {
        map.addLayer({
          id: 'sbt-route-line',
          type: 'line',
          source: 'sbt-route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#2563eb',
            'line-width': 4,
            'line-opacity': routeLine?.kind === 'road' ? 0.9 : 0.55,
            ...(routeLine?.kind === 'road' ? {} : { 'line-dasharray': [2, 2] }),
          },
        });
      }

      // Driven-path line source + layer (crew console). Drawn after the
      // planned route line so the real path reads above the straight plan.
      // The coordinates are the DECIMATED trail (~5 m, `polyline-simplify.ts`)
      // — the same subset `syncTrailLine` writes on every fix.
      if (!map.getSource('sbt-trail')) {
        map.addSource('sbt-trail', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: decimatedTrailCoords.length >= 2 ? decimatedTrailCoords : [],
            },
          },
        });
      }
      if (!map.getLayer('sbt-trail-line')) {
        map.addLayer({
          id: 'sbt-trail-line',
          type: 'line',
          source: 'sbt-trail',
          paint: {
            'line-color': '#16a34a',
            'line-width': 3,
            'line-opacity': 0.85,
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

      // The stops: ONE source with a circle layer (the dot), a symbol layer
      // for the sequence number inside it, and a symbol layer for the
      // always-visible name label — replacing the per-stop DOM markers (see
      // `stop-layer.ts`). The `kind` property drives the paint: `next` is the
      // amber enlarged dot, `current` the parent's home stop in green.
      if (!map.getSource('sbt-stops')) {
        map.addSource('sbt-stops', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });
      }
      if (!map.getLayer('sbt-stops-dot')) {
        map.addLayer({
          id: 'sbt-stops-dot',
          type: 'circle',
          source: 'sbt-stops',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'kind'], 'next'], 13, 9],
            'circle-color': [
              'match',
              ['get', 'kind'],
              'next',
              '#d97706',
              'current',
              '#16a34a',
              '#1d4ed8',
            ],
            'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'next'], 3, 2],
            'circle-stroke-color': '#ffffff',
          },
        });
      }
      if (!map.getLayer('sbt-stops-number')) {
        map.addLayer({
          id: 'sbt-stops-number',
          type: 'symbol',
          source: 'sbt-stops',
          layout: {
            // Explicit: a symbol layer without `text-font` falls back to
            // MapLibre's default stack, whose OpenFreeMap font URL 404s and
            // leaves the glyphs empty.
            'text-font': ['Noto Sans Regular'],
            'text-field': ['get', 'sequence'],
            'text-size': 11,
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#ffffff',
          },
        });
      }
      if (!map.getLayer('sbt-stops-label')) {
        map.addLayer({
          id: 'sbt-stops-label',
          type: 'symbol',
          source: 'sbt-stops',
          layout: {
            'text-font': ['Noto Sans Regular'],
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-anchor': 'top',
            'text-offset': [0, 1.1],
            'text-max-width': 8,
            'text-optional': true,
          },
          paint: {
            'text-color': '#0f172a',
            'text-halo-color': 'rgba(255, 255, 255, 0.92)',
            'text-halo-width': 1.5,
          },
        });
      }

      /*
       * The live bus as real 3D geometry (see `bus-3d.ts`).
       *
       * Added LAST, so it sits above every other app layer, and as a
       * `fill-extrusion` so it is an actual solid volume inside the WebGL
       * scene — depth-tested against the 3D buildings, shaded, fully opaque.
       * The flat DOM marker remains the 2D-camera representation; exactly one
       * of the two is ever showing (see `syncBusPresentation`).
       */
      if (!map.getSource(BUS_3D_SOURCE_ID)) {
        map.addSource(BUS_3D_SOURCE_ID, { type: 'geojson', data: EMPTY_BUS_MESH });
      }
      if (!map.getLayer(BUS_3D_LAYER_ID)) {
        map.addLayer(busExtrusionLayer() as unknown as maplibregl.LayerSpecification);
      }

      // The stop popup, via layer click handlers (the click affordance the
      // DOM markers used to carry). One popup instance, re-used per click;
      // the properties travel inside the GeoJSON, so the handler has no
      // closure over React state and never goes stale.
      const onStopLayerClick = (event: unknown) => {
        const click = event as {
          lngLat?: maplibregl.LngLat;
          features?: Array<{ properties?: unknown }>;
        };
        const feature = click.features?.[0];
        if (!feature || !click.lngLat) return;
        const properties = (feature.properties ?? {}) as {
          sequence?: unknown;
          name?: unknown;
          address?: unknown;
        };
        const sequence = String(properties.sequence ?? '');
        const name = String(properties.name ?? '');
        const address = properties.address ? String(properties.address) : '';
        stopPopupRef.current?.remove();
        stopPopupRef.current = new maplibregl.Popup({ offset: 12, closeButton: false })
          .setHTML(
            `<strong>Stop ${escapeHtml(sequence)}: ${escapeHtml(name)}</strong>${
              address ? `<div>${escapeHtml(address)}</div>` : ''
            }`,
          )
          .setLngLat(click.lngLat)
          .addTo(map);
      };
      // Bound once: `installOverlays` itself may run again after a style
      // reload, and MapLibre would otherwise stack duplicate listeners.
      if (!overlayHandlersBound) {
        overlayHandlersBound = true;
        map.on('click', 'sbt-stops-dot', onStopLayerClick as never);
        map.on('click', 'sbt-stops-number', onStopLayerClick as never);
        map.on('click', 'sbt-stops-label', onStopLayerClick as never);
        map.on('mouseenter', 'sbt-stops-dot', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'sbt-stops-dot', () => {
          map.getCanvas().style.cursor = '';
        });
        // The 3D bus keeps the flat marker's click affordance: tapping the
        // vehicle opens the same status popup.
        map.on('click', BUS_3D_LAYER_ID, ((event: { lngLat?: maplibregl.LngLat }) => {
          const popup = busPopupRef.current;
          const rendered = renderedRef.current;
          if (!popup) return;
          popup
            .setLngLat(
              rendered
                ? [rendered.longitude, rendered.latitude]
                : (event.lngLat as maplibregl.LngLat),
            )
            .addTo(map);
        }) as never);
        map.on('mouseenter', BUS_3D_LAYER_ID, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', BUS_3D_LAYER_ID, () => {
          map.getCanvas().style.cursor = '';
        });

        /*
         * The POI tap sheet (see `poi-sheet.ts`). ONE general click handler
         * classifies the tap over the features the map has ALREADY rendered
         * — `queryRenderedFeatures`, no network, no new source. The pure
         * `resolveMapTap` owns the precedence: stops and the bus (anywhere in
         * the hit list) win and this handler does nothing for them, so their
         * existing popups above stay the only popups; otherwise the first
         * usable POI opens the sheet and anything else (an "outside tap")
         * dismisses it.
         */
        const onMapTap = (event: unknown) => {
          const click = event as {
            point?: maplibregl.Point;
            originalEvent?: { button?: number; target?: EventTarget | null };
          };
          if (!click.point) return;
          // Primary button / touch only — secondary clicks keep their meaning.
          if (click.originalEvent?.button !== undefined && click.originalEvent.button !== 0) {
            return;
          }
          const features: TappedFeature[] = [];
          // The flat 2D bus marker is a DOM element: invisible to
          // queryRenderedFeatures, but a tap on it still beats a POI behind
          // it, so it goes into the pure decision as a synthetic entry.
          const target = click.originalEvent?.target;
          if (typeof Element !== 'undefined' && target instanceof Element) {
            if (target.closest('.maplibregl-marker')) {
              features.push({ layerId: BUS_DOM_MARKER_LAYER_ID });
            }
          }
          // Only ask for layers that exist (an override style might have no
          // `poi` layer); MapLibre errors when quering a missing layer id.
          const queryLayerIds = mapTapQueryLayerIds().filter((id) => map.getLayer(id));
          if (queryLayerIds.length > 0) {
            const rendered = map.queryRenderedFeatures(click.point, { layers: queryLayerIds });
            for (const feature of rendered) {
              features.push({
                layerId: feature.layer?.id ?? '',
                properties: feature.properties ?? null,
              });
            }
          }
          const outcome = resolveMapTap(features);
          setPoiSheet(outcome.type === 'poi' ? outcome.poi : null);
        };
        map.on('click', onMapTap as never);
        // Same pointer affordance the stops get, guarded for override styles
        // that have no POI layer at all.
        if (map.getLayer(POI_LAYER_ID)) {
          map.on('mouseenter', POI_LAYER_ID, () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', POI_LAYER_ID, () => {
            map.getCanvas().style.cursor = '';
          });
        }
      }
    };

    const onLoad = () => {
      // Overlays first, and defensively: a failure in any one of them must
      // not cost the others, and must never cost `mapReady`.
      try {
        installOverlays();
      } catch (error) {
        console.error('[MapView] overlay installation failed', error);
      }

      // Sources and layers exist: the map can now take overlays. Flip the
      // readiness flag *before* syncing so the sync helpers (which read
      // `mapReadyRef`) see a ready map, and so every overlay effect re-runs.
      mapReadyRef.current = true;
      setMapReady(true);

      // Apply everything the data effects may have tried to apply while the
      // map did not exist yet. This is the belt to `mapReady`'s braces: the
      // ordering bug that hid the bus marker cannot come back through either
      // path alone.
      syncOverlaysRef.current?.();

      // 3D presentation (sky + building extrusion) LAST: it is the newest,
      // most style-dependent code in this file, and the overlays above must
      // not depend on it succeeding.
      try {
        originalSkyRef.current = map.getStyle().sky;
        applyMapDimension(map, dimensionRef.current, originalSkyRef.current);
      } catch (error) {
        console.error('[MapView] 3D presentation unavailable for this style', error);
      }

      // Initial fit once per trip
      if (mappedStops.length > 0 || fixRef.current) {
        dispatch({ type: 'data-available' });
      }
    };

    map.on('load', onLoad);

    // A style reload (or any late style mutation) drops app sources/layers.
    // Re-installing them here is what keeps the stops and the 3D bus on the
    // map instead of silently vanishing for the rest of the session.
    const onStyleReload = () => {
      if (!mapReadyRef.current || !map.isStyleLoaded()) return;
      if (map.getLayer('sbt-stops-dot') && map.getLayer(BUS_3D_LAYER_ID)) return;
      try {
        installOverlays();
        syncOverlaysRef.current?.();
      } catch (error) {
        console.error('[MapView] overlay re-installation failed', error);
      }
    };
    map.on('styledata', onStyleReload as never);

    // The drawn bus is sized in metres but must keep a readable on-screen
    // size, so the mesh is rebuilt when the zoom changes.
    const onZoom = () => {
      busMeshSyncRef.current?.();
    };
    map.on('zoom', onZoom as never);

    return () => {
      map.off('movestart', onMoveStart as never);
      map.off('error', onMapErrorEvent as never);
      map.off('idle', onMapHealthy as never);
      map.off('styledata', onStyleData as never);
      map.off('styledata', onStyleReload as never);
      map.off('zoom', onZoom as never);
      map.off('load', onLoad);
      stopLoop();
      stopPopupRef.current?.remove();
      stopPopupRef.current = null;
      map.remove();
      // The map is gone: nothing may be applied to it until a new one loads.
      mapReadyRef.current = false;
      setMapReady(false);
      mapRef.current = null;
      lastPushedFixRef.current = null;
      busMarkerRef.current = null;
      busElementRef.current = null;
      busPopupRef.current = null;
    };
    // Run once when webglSupported becomes true and the first datum has
    // arrived — lineCoords/mappedStops are read inside the load handler via
    // dispatch/fitToData and re-creating the map on every stop change would
    // be wrong.
    //
    // `mapWanted` MUST be here, and it is a LATCH rather than `hasAnything`
    // itself, because the two goals pull in opposite directions and the latch
    // is what satisfies both:
    //
    // 1. **The PR #192 guarantee** — when the first datum (stops or fix)
    //    arrives after mount, the map must still initialise; with
    //    `[webglSupported]` alone the container existed but the map never
    //    appeared, leaving a dead map box on the admin trip page. The latch
    //    flips exactly once, on that first datum, so the effect re-runs at
    //    that moment exactly as it did when `hasAnything` sat in this array.
    // 2. **Create the map once** — `hasAnything` itself flips repeatedly
    //    during normal use (a fix going null on a trip switch while the next
    //    trip's stops are still loading), and with it in the array every flip
    //    tore the map down and rebuilt it: a new WebGL context, a re-fetched
    //    style, re-downloaded tiles. The latch never flips back, so the map
    //    survives those transitions. (The container div is therefore always
    //    mounted — hidden behind the empty state while there is nothing to
    //    show — because React would otherwise unmount the canvas out from
    //    under the surviving map.)
  }, [webglSupported, mapWanted, applyMapErrorState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.isStyleLoaded()) return;
    try {
      applyMapDimension(map, dimension, originalSkyRef.current);
    } catch (error) {
      console.error('[MapView] 3D presentation unavailable for this style', error);
    }
    if (user?.role === 'DRIVER' || dimension === '2d') map.touchPitch.disable();
    else map.touchPitch.enable();
    map.easeTo({
      pitch: dimension === '3d' ? MAP_3D_PITCH : 0,
      duration: reducedMotion ? 0 : 280,
    });
    // Swap the vehicle representation with the camera: solid extruded mesh
    // in 3D, flat marker in 2D. Never both, never neither.
    paintBus(renderedRef.current);
  }, [dimension, mapReady, reducedMotion, user?.role, paintBus]);

  // Update route line when stops change
  const syncRouteLine = useCallback(() => {
    const map = mapRef.current;
    if (!canSyncOverlays(map, mapReadyRef.current) || !map) return;
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
    const isRoad = routeLine?.kind === 'road';
    if (map.getLayer('sbt-route-casing')) {
      map.setLayoutProperty('sbt-route-casing', 'visibility', isRoad ? 'visible' : 'none');
    }
    if (map.getLayer('sbt-route-line')) {
      map.setPaintProperty('sbt-route-line', 'line-opacity', isRoad ? 0.9 : 0.55);
      map.setPaintProperty('sbt-route-line', 'line-dasharray', isRoad ? null : [2, 2]);
    }
  }, [lineCoords, routeLine?.kind]);

  // Update driven-path line when the trail grows. Writes the DECIMATED
  // coordinates — a fresh fix re-sets this whole line, so the payload is the
  // ~5 m subset, not the raw ~1,800-point breadcrumb of a two-hour run.
  const syncTrailLine = useCallback(() => {
    const map = mapRef.current;
    if (!canSyncOverlays(map, mapReadyRef.current) || !map) return;
    const source = map.getSource('sbt-trail') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: decimatedTrailCoords.length >= 2 ? decimatedTrailCoords : [],
      },
    });
  }, [decimatedTrailCoords]);

  // Update accuracy circle when fix or presentation changes
  const syncAccuracyCircle = useCallback(() => {
    const map = mapRef.current;
    if (!canSyncOverlays(map, mapReadyRef.current) || !map) return;
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

  // Stop layer — ONE GeoJSON source re-set wholesale (see `stop-layer.ts`).
  // The highlight (next stop / the parent's home stop) is a data-driven paint
  // property on the `kind`, so a highlight change re-styles the layer without
  // touching the DOM at all — the per-stop marker diffing that used to live
  // here is gone with the markers.
  const syncStopsLayer = useCallback(() => {
    const map = mapRef.current;
    if (!canSyncOverlays(map, mapReadyRef.current) || !map) return;
    const source = map.getSource('sbt-stops') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(stopsCollection ?? { type: 'FeatureCollection', features: [] });
  }, [stopsCollection]);

  // Bus marker creation / fix handling (motion machine)
  const syncBusMarker = useCallback(() => {
    const map = mapRef.current;

    // `reconcileBusMarker` owns the three-way decision (create / keep /
    // defer) so it can be pinned by a spec without a GL context. Crucially it
    // returns `deferred` — rather than tearing the marker down — when the map
    // is not ready yet, and the `mapReady` dep on the effect below guarantees
    // we are called again the moment it becomes ready.
    const outcomeMarker = reconcileBusMarker({
      map,
      ready: mapReadyRef.current,
      position: fix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
      marker: busMarkerRef.current,
      createMarker: (readyMap, lngLat) => {
        const el = createBusMarkerElement();
        setBusMarkerVisualState(el, busVisualStateRef.current);
        busElementRef.current = el;
        // `opacityWhenCovered` defaults to '0.2' in MapLibre and is applied
        // by the engine straight onto the element's inline style — which is
        // one of the ways the bus could read as a translucent ghost. The bus
        // is a vehicle, not a hint: it is opaque in every camera state.
        const created = new maplibregl.Marker({
          element: el,
          anchor: 'center',
          opacity: '1',
          opacityWhenCovered: '1',
        })
          .setLngLat(lngLat)
          .addTo(readyMap);
        const popup = new maplibregl.Popup({ offset: 24, closeButton: true });
        busPopupRef.current = popup;
        created.setPopup(popup);
        return created;
      },
    });
    busMarkerRef.current = outcomeMarker.marker;

    if (outcomeMarker.action === 'deferred') return;

    if (!fix) {
      // Fix disappeared: `reconcileBusMarker` already removed the marker.
      busElementRef.current = null;
      busPopupRef.current = null;
      motionRef.current.reset();
      renderedRef.current = null;
      lastPushedFixRef.current = null;
      // No position any more: clear the mesh too, or the last bus would stay
      // frozen on the map after the trip's fix went away.
      paintBus(null);
      return;
    }

    if (outcomeMarker.action === 'created') {
      // The camera must frame the bus the first time it appears. When the fix
      // arrived *before* the map existed, the one-shot `data-available`
      // dispatch below had already been swallowed by the empty map, so the
      // initial fit never happened. Re-dispatch here; `reduceFollowCamera`
      // makes it a no-op once a fit has been performed.
      if (!followRef.current.hasFitted) {
        dispatch({ type: 'data-available' });
      }
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

    // Push into motion machine. Guarded by identity so that syncing overlays
    // for an unrelated reason (a stop list change, the map's `load` event)
    // cannot feed the same sample to the motion machine twice.
    const now = nowMs();
    if (lastPushedFixRef.current !== fix) {
      lastPushedFixRef.current = fix;
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
      if (outcome.action === 'animated') startLoop();
    }
    lastFrameAtRef.current = now;
    if (busElementRef.current)
      setBusMarkerVisualState(busElementRef.current, busVisualStateRef.current);
    applyFrame(now);
  }, [fix, presentation.animate, reducedMotion, applyFrame, startLoop, dispatch, paintBus]);

  /**
   * The single place that pushes application state onto the map.
   *
   * Called from two directions, which is the whole point:
   *
   * - from the data effects below, whenever a prop changes;
   * - from `map.on('load')`, whenever the map itself (re)appears.
   *
   * Because both directions funnel through here, "data arrived before the map
   * existed" and "the map appeared before any data" produce the same end
   * state, so the ordering bug that hid the bus marker cannot regress.
   */
  const syncOverlays = useCallback(() => {
    syncRouteLine();
    syncTrailLine();
    syncAccuracyCircle();
    syncStopsLayer();
    syncBusMarker();
  }, [syncRouteLine, syncTrailLine, syncAccuracyCircle, syncStopsLayer, syncBusMarker]);

  // Let `map.on('load')` reach the latest sync routine without re-creating
  // the map every time a prop changes.
  useEffect(() => {
    syncOverlaysRef.current = syncOverlays;
    return () => {
      syncOverlaysRef.current = null;
    };
  }, [syncOverlays]);

  // Overlay effects. `mapReady` is in every dependency array on purpose: an
  // overlay whose data settled before the map loaded must be re-applied the
  // instant the map is ready, which is exactly what a dependency on the
  // readiness flag buys us.
  useEffect(() => {
    if (!mapReady) return;
    syncRouteLine();
  }, [mapReady, syncRouteLine]);

  useEffect(() => {
    if (!mapReady) return;
    syncTrailLine();
  }, [mapReady, syncTrailLine]);

  useEffect(() => {
    if (!mapReady) return;
    syncAccuracyCircle();
  }, [mapReady, syncAccuracyCircle]);

  useEffect(() => {
    if (!mapReady) return;
    syncStopsLayer();
  }, [mapReady, syncStopsLayer]);

  useEffect(() => {
    if (!mapReady) return;
    syncBusMarker();
  }, [mapReady, syncBusMarker]);

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

  // Fit once per trip when data becomes available (stops or fix).
  //
  // Gated on `mapReady` because `reduceFollowCamera` burns its one-shot
  // `hasFitted` flag on the first `data-available`/`fix-arrived` it sees. Fired
  // against a map that does not exist yet, the fit is dropped on the floor by
  // `fitToData` but the flag is spent, so the real fit never happens and the
  // camera sits at [0, 0] with the bus off-screen.
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

  if (webglSupported === false && !hasAnything) {
    // Same precedence as before the always-mounted container: with nothing to
    // show, the empty-data message wins over the WebGL message.
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

  // The camera buttons are default-on for every role; `controls` is a label
  // override only (parent pages say "Show whole route", the crew console uses
  // its translated strings).
  const fitRouteLabel = controls?.fitRouteLabel ?? 'Fit route';
  const followBusLabel = controls?.followBusLabel ?? 'Follow bus';

  return (
    <div className="map-shell" ref={shellRef}>
      {/* One DOM-level SVG source. Each marker uses symbols from these defs. */}
      <svg className="map-marker-defs" aria-hidden="true" focusable="false">
        <defs dangerouslySetInnerHTML={{ __html: BUS_MARKER_DEFS_SVG }} />
      </svg>
      {/*
        The container is ALWAYS mounted — including while the trip has nothing
        to show — because the map is created once (see the map-init effect's
        dependency note): unmounting this div would tear the canvas out from
        under the surviving map. While empty it is merely invisible, with the
        empty state rendered over it.
      */}
      <div
        ref={containerRef}
        className={hasAnything ? undefined : 'map-container-hidden'}
        style={{ width: '100%', height: '100%', minHeight: '420px' }}
        role="region"
        aria-label="Live bus map"
      />
      {!hasAnything ? (
        <div className="map-empty-overlay">
          <div className="empty">
            <p className="muted">No GPS position or mapped stops for this trip yet.</p>
          </div>
        </div>
      ) : null}
      <div className="map-camera-controls">
        <div className="map-utility-controls">
          <div className="map-dimension-toggle" role="radiogroup" aria-label="Map view">
            {(['2d', '3d'] as const).map((option) => {
              const active = dimension === option;
              const disabled = option === '3d' && threeDUnavailable;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${option.toUpperCase()} map`}
                  disabled={disabled}
                  className={active ? 'is-active' : undefined}
                  onClick={() => setPreferredDimension(option)}
                >
                  {option.toUpperCase()}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="map-info-control"
            aria-label={legendOpen ? 'Close map legend' : 'Show map legend'}
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((open) => !open)}
          >
            i
          </button>
        </div>
        <button
          type="button"
          className="map-follow-control"
          onClick={() => fitRouteRef.current?.()}
          aria-label={fitRouteLabel}
        >
          {fitRouteLabel}
        </button>
        <button
          type="button"
          className={`map-follow-control${exploring ? '' : ' is-following'}`}
          onClick={() => recenterRef.current?.()}
          aria-label={followBusLabel}
          aria-pressed={!exploring}
        >
          {followBusLabel}
        </button>
      </div>
      {poiSheet ? (
        <div className="map-poi-sheet" role="dialog" aria-label="Place details">
          <div className="map-poi-sheet-text">
            <strong>{poiSheet.name ?? poiSheet.category}</strong>
            {poiSheet.name ? <span className="map-poi-sheet-category">{poiSheet.category}</span> : null}
          </div>
          <button
            type="button"
            className="map-poi-sheet-close"
            aria-label="Close place details"
            onClick={() => setPoiSheet(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      {legendOpen ? (
        <div className="map-legend" role="region" aria-label="Map legend">
          <div className="map-legend-header">
            <strong>Map legend</strong>
            <button
              type="button"
              aria-label="Close map legend"
              onClick={() => setLegendOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="map-legend-row">
            <span className="map-legend-bus" aria-hidden="true">
              <svg viewBox={`0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}`}>
                <use href={`#${BUS_MARKER_ART_ID}`} />
              </svg>
            </span>
            <span>Bus</span>
          </div>
          <div className="map-legend-row">
            <span className="map-legend-dot is-next" aria-hidden="true" />
            <span>Next stop</span>
          </div>
          <div className="map-legend-row">
            <span className="map-legend-dot" aria-hidden="true" />
            <span>Stop</span>
          </div>
          <div className="map-legend-row">
            <span className="map-legend-line is-driven" aria-hidden="true" />
            <span>Driven path</span>
          </div>
          <div className="map-legend-row">
            <span
              className={`map-legend-line${routeLine?.kind === 'road' ? '' : ' is-planned'}`}
              aria-hidden="true"
            />
            <span>
              {routeLine?.kind === 'road'
                ? 'Road route'
                : 'Straight-line estimate — road route unavailable'}
            </span>
          </div>
        </div>
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
