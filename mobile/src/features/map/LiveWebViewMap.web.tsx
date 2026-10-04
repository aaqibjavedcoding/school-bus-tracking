import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type NativeSyntheticEvent } from 'react-native';
// `maplibre-gl` is the workspace's existing MapLibre engine (the `web` app
// depends on it and npm hoists it to the repo root). Importing it here adds
// no dependency to the mobile app's install graph — and this file is a
// `.web.tsx`, so Metro only ever bundles it for the web platform, where
// `@maplibre/maplibre-react-native` (native-only) cannot exist at all.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import {
  BUS_MARKER_ART_ID,
  BUS_MARKER_BOX,
  BUS_MARKER_DEFS_SVG,
  BUS_MARKER_SHADOW_ID,
  MAP_3D_PITCH,
  MAP_3D_SKY,
  MAP_BUILDING_LAYER_ID,
  MAP_MAX_PITCH,
  buildingExtrusionLayerForStyle,
  type MapDimension,
  type MapFallbackReason,
} from '@school-bus-tracking/map-assets';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import { isTrustworthyDeviceHeading, type BusMotionFix } from './bus-motion.ts';
import { SINGLE_POINT_ZOOM, initialCameraFor } from './fit-camera.ts';
import { resolveMapStyleUrl } from './map-style';
import { driverFollowControls } from './map-controls.ts';
import { useFollowCamera } from './useFollowCamera';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { stopsLayerCollection, type StopLayerStop } from './stop-layer.ts';
import { buildArrivalZoneCenter, buildArrivalZonePolygon } from '../crew/trip-map-geometry.ts';
import { MapLegend } from './MapLegend';
import { useMapCameraMode } from './useMapCameraMode';

/**
 * The mobile WEB live map — a real MapLibre GL JS map, not the text list the
 * web fallbacks used to be.
 *
 * `npm run web` (the Expo web preview) cannot load
 * `@maplibre/maplibre-react-native` — it is a native module — so the
 * `.web.tsx` variants of `BusMap` and `DriverTripMap` used to render a
 * summary list instead of a map: no bus on the map, because there was no map.
 * This component renders the real thing with the same policies the native
 * `LiveMapSurface` uses:
 *
 * - **Style**: `map-style.ts`'s `resolveMapStyleUrl` — OpenFreeMap over OSM
 *   by default, the https-only `EXPO_PUBLIC_MAP_STYLE_URL` override. The
 *   native pipeline's backoff/glyph repair (`use-map-style.ts`) is a native
 *   concern (it wires `TransformRequestManager` and the native log events)
 *   and stays out of the web build; the URL policy itself is the one shared
 *   definition.
 * - **Camera**: the SAME `useFollowCamera` binding, through a tiny adapter
 *   that satisfies the native `CameraRef` interface over MapLibre GL JS's own
 *   `easeTo`/`zoomTo`. The follow/zoom control policy (`map-controls.ts`) is
 *   not forked — the buttons below the map are the same three states.
 * - **Stops**: the same ONE GeoJSON source + circle/symbol layers
 *   (`stop-layer.ts`), with the next-stop highlight as data-driven paint.
 * - **Arrival zone**: the same PR #193 rendering — a thin dashed ring at the
 *   server's `effective_radius_meters` plus a solid dot at the surveyed
 *   coordinate.
 *
 * The bus is a DOM marker over the canvas (MapLibre GL JS's marker), rotated
 * by heading through a CSS transform — the web twin of the native
 * ViewAnnotation marker.
 */

/** Which role's surface this is — decides the route line's paint. */
export type WebViewMapVariant = 'driver' | 'observer';

export interface LiveWebViewMapProps {
  variant: WebViewMapVariant;
  stops: StopResponse[];
  fix: BusMotionFix | null;
  tripId?: string | null;
  height?: number;
  nextStopId?: string | null;
  trailFeature?: Feature<LineString> | null;
  /**
   * The line ahead of the bus: the routing engine's road polyline when the
   * geometry exists, the planned stop-to-stop segments otherwise — the twin
   * of `LiveMapSurface`'s prop of the same name. Painted solid amber either
   * way; `plannedLineKind` is what the legend caption follows.
   */
  plannedFeature?: Feature<LineString> | null;
  /** Which shape `plannedFeature` holds (see `LiveMapSurface`). */
  plannedLineKind?: 'road' | 'planned';
  accuracyCircleFeature?: Feature<Polygon> | null;
  animate?: boolean;
  busTitle?: string;
  busDescription?: string;
  /** The wrapper's status panel, rendered top-left over the map. */
  panel?: React.ReactNode;
  /** The card-header line above the map. */
  headerTitle?: string | null;
}

const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/** See `LiveMapSurface.tsx` — the same constants, the same reasoning. */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';
const ZONE_STROKE = 'rgba(180, 83, 9, 0.9)';
const ZONE_CENTER_DOT = 'rgb(180, 83, 9)';
const TRAIL_COLOR = colors.status.success;
const PLANNED_COLOR = colors.primary[600];

function fallbackNoticeMessage(reason: MapFallbackReason): string {
  return reason === 'reduced-motion'
    ? t('map.performance.reducedMotion')
    : t('map.performance.droppedFrames');
}

/** Apply/remove only presentation layers; the loaded OpenFreeMap sources stay untouched. */
function applyWebDimension(
  map: maplibregl.Map,
  dimension: MapDimension,
  originalSky: unknown,
): void {
  map.setMaxPitch(MAP_MAX_PITCH);
  const setSky = map.setSky.bind(map) as (sky?: unknown) => unknown;
  if (dimension === '3d') {
    setSky(MAP_3D_SKY);
    if (!map.getLayer(MAP_BUILDING_LAYER_ID)) {
      const layer = buildingExtrusionLayerForStyle(map.getStyle());
      if (layer) {
        const before = map.getStyle().layers.find((candidate) => candidate.type === 'symbol')?.id;
        map.addLayer(layer as unknown as maplibregl.LayerSpecification, before);
      }
    }
    return;
  }
  if (map.getLayer(MAP_BUILDING_LAYER_ID)) map.removeLayer(MAP_BUILDING_LAYER_ID);
  setSky(originalSky);
}

/** One zoom level per button press, bounded — see `map-controls.ts`. */
const ROUTE_PAINT: Record<WebViewMapVariant, object> = {
  driver: {
    'line-color': colors.neutral[400],
    'line-width': 2,
    'line-dasharray': [4, 4],
    'line-opacity': 0.8,
  },
  observer: {
    'line-color': colors.primary[600],
    'line-width': 3,
    'line-dasharray': [4, 4],
  },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const BUS_DEFS_ID = 'sbt-mobile-web-bus-defs';
const BUS_STYLE_ID = 'sbt-mobile-web-bus-style';

/** Mount the one shared symbol definition and its small presence styles once. */
function ensureSharedBusMarkerResources(): void {
  if (!document.getElementById(BUS_DEFS_ID)) {
    const root = document.createElementNS(SVG_NS, 'svg');
    root.id = BUS_DEFS_ID;
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('width', '0');
    root.setAttribute('height', '0');
    root.style.position = 'absolute';
    root.style.overflow = 'hidden';
    const defs = document.createElementNS(SVG_NS, 'defs');
    // This happens once per document, never during marker creation. Each
    // marker below is DOM nodes + `<use>`, not a parsed bus SVG clone.
    defs.innerHTML = BUS_MARKER_DEFS_SVG;
    root.append(defs);
    document.body.append(root);
  }
  if (!document.getElementById(BUS_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = BUS_STYLE_ID;
    style.textContent = `
      @keyframes sbt-mobile-web-bus-pulse { 0%,100% { transform:scale(.8); opacity:.06 } 50% { transform:scale(1.28); opacity:.3 } }
      .sbt-mobile-web-bus.is-live-moving:not(.is-reduced-motion) .sbt-mobile-web-bus-halo { animation:sbt-mobile-web-bus-pulse 2.4s ease-in-out infinite; }
      .sbt-mobile-web-bus:not(.is-live-moving) .sbt-mobile-web-bus-cone { display:none; }
      .sbt-mobile-web-bus.is-stale .sbt-mobile-web-bus-art, .sbt-mobile-web-bus.is-stale .sbt-mobile-web-bus-shadow { filter:grayscale(1) saturate(.18); opacity:.68; }
    `;
    document.head.append(style);
  }
}

function svgUse(symbolId: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.width = `${BUS_MARKER_BOX.width}px`;
  svg.style.height = `${BUS_MARKER_BOX.height}px`;
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.append(use);
  return svg;
}

/**
 * Native web's MapLibre marker uses the same defs/use source as the console.
 * Its shadow stays static outside the rotor; only the coach and cone rotate.
 */
function createBusMarkerElement(): { element: HTMLDivElement; rotor: HTMLDivElement } {
  ensureSharedBusMarkerResources();
  const element = document.createElement('div');
  element.className = 'sbt-mobile-web-bus';
  element.setAttribute('aria-hidden', 'true');
  element.style.cssText = 'width:0;height:0;overflow:visible;';
  const anchor = document.createElement('div');
  anchor.style.cssText = `position:absolute;left:0;top:0;width:${BUS_MARKER_BOX.rotationBox}px;height:${BUS_MARKER_BOX.rotationBox}px;display:grid;place-items:center;transform:translate(-50%,-50%);overflow:visible;`;
  const shadow = svgUse(BUS_MARKER_SHADOW_ID, 'sbt-mobile-web-bus-shadow');
  shadow.style.position = 'absolute';
  const halo = document.createElement('div');
  halo.className = 'sbt-mobile-web-bus-halo';
  halo.style.cssText =
    'position:absolute;width:40px;height:40px;border-radius:999px;background:rgb(245 158 11 / .25);opacity:0;pointer-events:none;';
  const rotor = document.createElement('div');
  rotor.style.cssText = `position:relative;width:${BUS_MARKER_BOX.width}px;height:${BUS_MARKER_BOX.height}px;display:grid;place-items:center;overflow:visible;transform-origin:50% 50%;will-change:transform;`;
  const cone = document.createElement('div');
  cone.className = 'sbt-mobile-web-bus-cone';
  cone.style.cssText =
    'position:absolute;z-index:-1;top:-15px;left:5px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:18px solid rgb(37 99 235 / .36);';
  const art = svgUse(BUS_MARKER_ART_ID, 'sbt-mobile-web-bus-art');
  rotor.append(cone, art);
  anchor.append(shadow, halo, rotor);
  element.append(anchor);
  return { element, rotor };
}

/** Whether this browser can give MapLibre GL JS a WebGL2 context. */
export function webgl2Supported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * The WebGL verdict, as render state: `null` only before the client can
 * answer (SSR / first paint), `false` when the browser cannot host the
 * engine — the callers keep their summary list for exactly that case.
 */
export function useWebgl2Supported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(() =>
    typeof document === 'undefined' ? null : webgl2Supported(),
  );
  useEffect(() => {
    if (supported === null) setSupported(webgl2Supported());
  }, [supported]);
  return supported;
}

/**
 * A `CameraRef` over a MapLibre GL JS map — the port `useFollowCamera`
 * drives. Only `easeTo`/`zoomTo` are on the follow camera's hot path (the
 * controller's fit goes through `easeTo` with the floored fit from
 * `initialCameraFor`); the rest exist to satisfy the interface.
 */
function cameraRefFor(map: maplibregl.Map): CameraRef {
  return {
    jumpTo: (options) => map.jumpTo({ center: options.center }),
    easeTo: (options) => {
      const stop: maplibregl.EaseToOptions & { zoom?: number } = {
        center: options.center,
        duration: options.duration,
      };
      if (options.zoom !== undefined) stop.zoom = options.zoom;
      map.easeTo(stop);
    },
    flyTo: (options) => map.flyTo({ center: options.center, duration: options.duration }),
    fitBounds: (bounds, options) =>
      map.fitBounds(bounds, {
        padding: options?.padding as maplibregl.FitBoundsOptions['padding'],
        duration: options?.duration,
      }),
    zoomTo: (zoom, options) => map.easeTo({ zoom, duration: options?.duration ?? 500 }),
    setStop: async () => {
      // The follow controller never uses imperative stops; nothing to do.
    },
  };
}

/** The region event shape `useFollowCamera` expects, from a GL JS move. */
function regionEvent(
  map: maplibregl.Map,
  isGesture: boolean,
): NativeSyntheticEvent<ViewStateChangeEvent> {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    nativeEvent: {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      bounds: [
        [bounds.getWest(), bounds.getSouth()],
        [bounds.getEast(), bounds.getNorth()],
      ],
      userInteraction: isGesture,
    },
  } as unknown as NativeSyntheticEvent<ViewStateChangeEvent>;
}

export const LiveWebViewMap: React.FC<LiveWebViewMapProps> = ({
  variant,
  stops,
  fix,
  tripId = null,
  height = 260,
  nextStopId = null,
  trailFeature = null,
  plannedFeature = null,
  plannedLineKind = 'planned',
  accuracyCircleFeature = null,
  animate = false,
  busTitle,
  busDescription = '',
  panel = null,
  headerTitle = null,
}) => {
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
  const { dimension, threeDUnavailable, fallbackNotice, setPreferredDimension, recordRenderFrame } =
    useMapCameraMode(reducedMotion);
  const [legendOpen, setLegendOpen] = useState(false);
  useTranslation();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const cameraRefHolder = useRef<CameraRef | null>(null);
  const busMarkerRef = useRef<maplibregl.Marker | null>(null);
  const busRotorRef = useRef<HTMLDivElement | null>(null);
  const originalSkyRef = useRef<unknown>(undefined);
  const dimensionRef = useRef(dimension);
  dimensionRef.current = dimension;
  const recordRenderFrameRef = useRef(recordRenderFrame);
  recordRenderFrameRef.current = recordRenderFrame;
  const [mapReady, setMapReady] = useState(false);

  const locatedStops = useMemo(
    () =>
      stops.filter(
        (stop): stop is StopLayerStop => stop.latitude !== null && stop.longitude !== null,
      ),
    [stops],
  );
  const routeCoordinates = useMemo(
    () => locatedStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
    [locatedStops],
  );
  const routeLineFeature = useMemo<Feature<LineString> | null>(() => {
    if (routeCoordinates.length < 2) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates.map((point) => [point.longitude, point.latitude]),
      },
    };
  }, [routeCoordinates]);

  const stopsCollection = useMemo(
    () =>
      stopsLayerCollection(locatedStops, nextStopId, (stop, kind) =>
        kind === 'next'
          ? `${t('map.nextBadge')} · ${t('map.stopLabel', {
              number: stop.sequence_number,
              name: stop.name,
            })}`
          : t('map.stopLabel', { number: stop.sequence_number, name: stop.name }),
      ),
    [locatedStops, nextStopId, locale],
  );

  const arrivalZoneFeature = useMemo(
    () => buildArrivalZonePolygon(stops, nextStopId),
    [stops, nextStopId],
  );
  const arrivalZoneCenterFeature = useMemo<Feature<Point> | null>(
    () => buildArrivalZoneCenter(stops, nextStopId),
    [stops, nextStopId],
  );

  // ── Follow camera: the SAME hook the native surface uses ────────────────
  const {
    cameraRef,
    exploring,
    zoomLimits,
    zoomIn,
    zoomOut,
    onFrame,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    recenter,
  } = useFollowCamera({
    routeCoordinates,
    fix: fix ? { latitude: fix.latitude, longitude: fix.longitude } : null,
    tripId,
    singlePointZoom: SINGLE_POINT_ZOOM,
    edgePadding: FIT_EDGE_PADDING,
  });

  const [followEnabled, setFollowEnabled] = useState(true);
  const followEnabledRef = useRef(true);
  const toggleFollow = useCallback(() => {
    setFollowEnabled((previous) => {
      const next = !previous;
      followEnabledRef.current = next;
      return next;
    });
  }, []);
  const turnFollowOn = useCallback(() => {
    if (!followEnabledRef.current) toggleFollow();
    recenter();
  }, [toggleFollow, recenter]);

  const controls = driverFollowControls({
    hasFix: fix !== null,
    followEnabled,
    exploring,
  });

  // ── The map, created once ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !webgl2Supported()) return;

    const styleUrl = resolveMapStyleUrl({
      EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
    });
    const frame = initialCameraFor(
      fix
        ? [...routeCoordinates, { latitude: fix.latitude, longitude: fix.longitude }]
        : routeCoordinates,
    );

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: (frame?.center ?? [0, 0]) as [number, number],
      zoom: frame?.zoom ?? SINGLE_POINT_ZOOM - 1,
      pitch: dimensionRef.current === '3d' ? MAP_3D_PITCH : 0,
      maxPitch: MAP_MAX_PITCH,
      dragRotate: variant !== 'driver',
      touchPitch: variant !== 'driver' && dimensionRef.current === '3d',
      attributionControl: { compact: false },
    });
    if (variant === 'driver') map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    cameraRefHolder.current = cameraRefFor(map);
    cameraRef.current = cameraRefHolder.current;

    // Gesture attribution: GL JS sets `originalEvent` only for user gestures
    // — the same signal the native binding reads off the region events.
    map.on('move', (event) => {
      onRegionChange(
        regionEvent(map, Boolean((event as { originalEvent?: unknown }).originalEvent)),
      );
    });
    map.on('moveend', (event) => {
      onRegionChangeComplete(
        regionEvent(map, Boolean((event as { originalEvent?: unknown }).originalEvent)),
      );
    });
    map.on('render', () => {
      recordRenderFrameRef.current(
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now(),
      );
    });

    map.on('load', () => {
      originalSkyRef.current = map.getStyle().sky;
      applyWebDimension(map, dimensionRef.current, originalSkyRef.current);

      // Route, trail, planned — one GeoJSON source each.
      map.addSource('sbt-route', { type: 'geojson', data: emptyLine() });
      map.addLayer({
        id: 'sbt-route-line',
        type: 'line',
        source: 'sbt-route',
        paint: ROUTE_PAINT[variant],
      });
      map.addSource('sbt-trail', { type: 'geojson', data: emptyLine() });
      map.addLayer({
        id: 'sbt-trail-line',
        type: 'line',
        source: 'sbt-trail',
        paint: {
          'line-color': TRAIL_COLOR,
          'line-width': 3,
          'line-dasharray': [1.5, 1.5],
        },
      });
      map.addSource('sbt-planned', { type: 'geojson', data: emptyLine() });
      map.addLayer({
        id: 'sbt-planned-line',
        type: 'line',
        source: 'sbt-planned',
        paint: { 'line-color': PLANNED_COLOR, 'line-width': 4 },
      });

      // The GPS accuracy circle.
      map.addSource('sbt-accuracy', { type: 'geojson', data: emptyCollection() });
      map.addLayer({
        id: 'sbt-accuracy-fill',
        type: 'fill',
        source: 'sbt-accuracy',
        paint: { 'fill-color': ACCURACY_FILL },
      });
      map.addLayer({
        id: 'sbt-accuracy-stroke',
        type: 'line',
        source: 'sbt-accuracy',
        paint: { 'line-color': ACCURACY_STROKE, 'line-width': 1 },
      });

      // The next stop's arrival zone: the PR #193 rendering, unchanged —
      // a THIN DASHED RING at the server's effective radius, and a solid
      // dot at the surveyed coordinate itself.
      map.addSource('sbt-arrival-zone', { type: 'geojson', data: emptyCollection() });
      map.addLayer({
        id: 'sbt-arrival-zone-stroke',
        type: 'line',
        source: 'sbt-arrival-zone',
        paint: {
          'line-color': ZONE_STROKE,
          'line-width': 1.5,
          'line-opacity': 0.55,
          'line-dasharray': [3, 3],
        },
      });
      map.addSource('sbt-arrival-zone-center', { type: 'geojson', data: emptyCollection() });
      map.addLayer({
        id: 'sbt-arrival-zone-center-dot',
        type: 'circle',
        source: 'sbt-arrival-zone-center',
        paint: {
          'circle-radius': 4,
          'circle-color': ZONE_CENTER_DOT,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });

      // The stops: ONE source, one circle layer, one label layer.
      map.addSource('sbt-stops', { type: 'geojson', data: emptyCollection() });
      map.addLayer({
        id: 'sbt-stops-dot',
        type: 'circle',
        source: 'sbt-stops',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'kind'], 'next'], 9, 5.5],
          'circle-color': [
            'case',
            ['==', ['get', 'kind'], 'next'],
            colors.primary[600],
            colors.neutral[700],
          ],
          'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'next'], 2.5, 2],
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'sbt-stops-label',
        type: 'symbol',
        source: 'sbt-stops',
        layout: {
          'text-font': ['Noto Sans Regular'],
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-anchor': 'left',
          'text-offset': [1, 0],
          'text-max-width': 7,
          'text-optional': true,
        },
        paint: {
          'text-color': colors.neutral[900],
          'text-halo-color': 'rgba(255, 255, 255, 0.92)',
          'text-halo-width': 1.5,
        },
      });

      onMapReady();
      setMapReady(true);
    });

    return () => {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      busRotorRef.current = null;
      map.remove();
      mapRef.current = null;
      cameraRefHolder.current = null;
      cameraRef.current = null;
      setMapReady(false);
    };
    // The map is created once; everything data-dependent flows through the
    // sync effects below. `fix`/`routeCoordinates` are read for the initial
    // camera only, exactly as the native surface reads its `initialViewState`
    // once.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.isStyleLoaded()) return;
    applyWebDimension(map, dimension, originalSkyRef.current);
    if (variant === 'driver' || dimension === '2d') map.touchPitch.disable();
    else map.touchPitch.enable();
    map.easeTo({
      pitch: dimension === '3d' ? MAP_3D_PITCH : 0,
      duration: reducedMotion ? 0 : 280,
    });
  }, [dimension, mapReady, reducedMotion, variant]);

  // ── Overlay sync (the same shapes the native surface renders) ───────────
  const setLineData = useCallback((id: string, feature: Feature<LineString> | null) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(feature ?? emptyLine());
  }, []);

  const setCollectionData = useCallback((id: string, feature: Feature | null) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(feature ?? emptyCollection());
  }, []);

  useEffect(() => {
    if (mapReady) setLineData('sbt-route', routeLineFeature);
  }, [mapReady, setLineData, routeLineFeature]);
  useEffect(() => {
    if (mapReady) setLineData('sbt-trail', trailFeature);
  }, [mapReady, setLineData, trailFeature]);
  useEffect(() => {
    if (mapReady) setLineData('sbt-planned', plannedFeature);
  }, [mapReady, setLineData, plannedFeature]);
  useEffect(() => {
    if (mapReady) setCollectionData('sbt-accuracy', accuracyCircleFeature);
  }, [mapReady, setCollectionData, accuracyCircleFeature]);
  useEffect(() => {
    if (mapReady) setCollectionData('sbt-arrival-zone', arrivalZoneFeature);
  }, [mapReady, setCollectionData, arrivalZoneFeature]);
  useEffect(() => {
    if (mapReady) setCollectionData('sbt-arrival-zone-center', arrivalZoneCenterFeature);
  }, [mapReady, setCollectionData, arrivalZoneCenterFeature]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.isStyleLoaded()) return;
    const source = map.getSource('sbt-stops') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(stopsCollection ?? emptyCollection());
  }, [mapReady, stopsCollection]);

  // ── The bus marker: one DOM marker, moved and rotated per fix ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!fix) {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      busRotorRef.current = null;
      return;
    }
    if (!busMarkerRef.current) {
      const { element, rotor } = createBusMarkerElement();
      busRotorRef.current = rotor;
      busMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([fix.longitude, fix.latitude])
        .addTo(map);
    } else {
      busMarkerRef.current.setLngLat([fix.longitude, fix.latitude]);
    }
    // The same 3 km/h heading trust gate as the native motion machine: a
    // parked bus must not show a direction cone for GPS course noise.
    const liveMoving = animate && isTrustworthyDeviceHeading(fix.heading, fix.speed);
    const element = busMarkerRef.current.getElement();
    element.classList.toggle('is-stale', !animate);
    element.classList.toggle('is-live-moving', liveMoving);
    element.classList.toggle('is-reduced-motion', reducedMotion);
    if (busRotorRef.current) {
      busRotorRef.current.style.transform = `rotate(${fix.heading ?? 0}deg)`;
    }
    // Follow the newest fix through the shared controller (the native
    // surface feeds the controller from the marker's animation loop; the
    // web marker moves per fix, so this is the per-fix equivalent).
    onFrame({
      latitude: fix.latitude,
      longitude: fix.longitude,
      headingDeg: fix.heading ?? null,
      moving: animate,
      sourceSpeedKmh: fix.speed ?? null,
    });
  }, [mapReady, fix, animate, reducedMotion, onFrame]);

  // Same caption rule as the native surface: the words follow the shape
  // actually drawn (road route / planned order / straight connectors).
  const plannedOrderDetail = plannedFeature
    ? plannedLineKind === 'road'
      ? t('map.roadNotice')
      : t('map.plannedNotice')
    : t('map.routeNotice');
  const zoneDetail = arrivalZoneFeature ? t('map.arrivalZoneNotice') : null;
  const fallbackMessage = fallbackNotice ? fallbackNoticeMessage(fallbackNotice) : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.headerLineText} numberOfLines={2}>
          {headerTitle ?? busTitle ?? t('map.busA11y')}
        </Text>
      </View>
      {busDescription ? (
        <Text style={styles.headerMuted} numberOfLines={1}>
          {busDescription}
        </Text>
      ) : null}
      <View style={[styles.wrap, { height }]}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
          role="region"
          aria-label={t('map.busA11y')}
        />
        {panel}
        <View style={styles.controls}>
          <View style={styles.utilityRow}>
            <View style={styles.dimensionToggle} accessibilityRole="radiogroup">
              {(['2d', '3d'] as const).map((option) => {
                const active = dimension === option;
                const disabled = option === '3d' && threeDUnavailable;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setPreferredDimension(option)}
                    disabled={disabled}
                    accessibilityRole="radio"
                    accessibilityLabel={t(
                      option === '2d' ? 'map.dimension.twoD' : 'map.dimension.threeD',
                    )}
                    accessibilityState={{ checked: active, disabled }}
                    style={[
                      styles.dimensionButton,
                      active ? styles.dimensionButtonActive : null,
                      disabled ? styles.controlDisabled : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dimensionButtonText,
                        active ? styles.dimensionButtonTextActive : null,
                      ]}
                    >
                      {option === '2d' ? '2D' : '3D'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setLegendOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={t(legendOpen ? 'map.legend.close' : 'map.legend.open')}
              accessibilityState={{ expanded: legendOpen }}
              style={styles.infoButton}
            >
              <Text style={styles.infoButtonText}>i</Text>
            </Pressable>
          </View>
          {fallbackMessage ? (
            <View style={styles.performanceNotice} accessibilityLiveRegion="polite">
              <Text style={styles.performanceNoticeText}>{fallbackMessage}</Text>
            </View>
          ) : null}
          <Pressable
            onPress={turnFollowOn}
            disabled={controls.primary.disabled}
            accessibilityRole="button"
            accessibilityLabel={t(controls.primary.labelKey)}
            accessibilityHint={controls.waitingForFix ? t('map.noFixA11y') : undefined}
            accessibilityState={{
              disabled: controls.primary.disabled,
              selected: controls.primary.active,
            }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.followButton,
              controls.primary.active ? styles.followButtonActive : null,
              pressed ? styles.followPressed : null,
              controls.primary.disabled ? styles.controlDisabled : null,
            ]}
          >
            <Text
              style={[
                styles.followButtonText,
                controls.primary.active ? styles.followButtonTextActive : null,
              ]}
            >
              {t(controls.primary.labelKey)}
            </Text>
          </Pressable>
          {controls.secondary.visible ? (
            <Pressable
              onPress={toggleFollow}
              disabled={controls.secondary.disabled}
              accessibilityRole="switch"
              accessibilityLabel={t(controls.secondary.labelKey)}
              accessibilityState={{
                checked: !controls.secondary.disabled,
                disabled: controls.secondary.disabled,
              }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.followSwitch,
                pressed ? styles.followPressed : null,
                controls.secondary.disabled ? styles.controlDisabled : null,
              ]}
            >
              <Text style={styles.followSwitchText}>{t(controls.secondary.labelKey)}</Text>
            </Pressable>
          ) : null}
          <View style={styles.zoomGroup}>
            <Pressable
              onPress={zoomIn}
              disabled={!zoomLimits.canZoomIn}
              accessibilityRole="button"
              accessibilityLabel={t('map.zoomIn')}
              accessibilityState={{ disabled: !zoomLimits.canZoomIn }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.zoomButton,
                styles.zoomButtonTop,
                pressed ? styles.followPressed : null,
                zoomLimits.canZoomIn ? null : styles.controlDisabled,
              ]}
            >
              <Text style={styles.zoomButtonText}>+</Text>
            </Pressable>
            <Pressable
              onPress={zoomOut}
              disabled={!zoomLimits.canZoomOut}
              accessibilityRole="button"
              accessibilityLabel={t('map.zoomOut')}
              accessibilityState={{ disabled: !zoomLimits.canZoomOut }}
              hitSlop={6}
              style={({ pressed }) => [
                styles.zoomButton,
                pressed ? styles.followPressed : null,
                zoomLimits.canZoomOut ? null : styles.controlDisabled,
              ]}
            >
              <Text style={styles.zoomButtonText}>−</Text>
            </Pressable>
          </View>
        </View>
        {legendOpen ? (
          <MapLegend
            onClose={() => setLegendOpen(false)}
            plannedOrderDetail={plannedOrderDetail}
            arrivalZoneDetail={zoneDetail}
          />
        ) : null}
        <Text accessibilityLiveRegion="polite" style={styles.screenReaderOnly}>
          {t(controls.stateKey)}
        </Text>
      </View>
    </View>
  );
};

function emptyLine(): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    minHeight: 36,
  },
  headerLineText: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.primary[700],
  },
  headerMuted: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginBottom: spacing.xs,
  },
  wrap: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  controls: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    alignItems: 'flex-end',
    gap: spacing.xs,
    maxWidth: '40%',
  },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dimensionToggle: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: '#ffffff',
  },
  dimensionButton: {
    minWidth: 42,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  dimensionButtonActive: {
    backgroundColor: colors.primary[600],
  },
  dimensionButtonText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  dimensionButtonTextActive: {
    color: '#ffffff',
  },
  infoButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: '#ffffff',
  },
  infoButtonText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    fontStyle: 'italic',
    color: colors.neutral[700],
  },
  performanceNotice: {
    maxWidth: 190,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  performanceNoticeText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[600],
    textAlign: 'right',
  },
  controlDisabled: {
    opacity: 0.55,
  },
  followButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  followButtonActive: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[700],
  },
  followPressed: {
    backgroundColor: colors.neutral[100],
  },
  followButtonText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  followButtonTextActive: {
    color: '#ffffff',
  },
  followSwitch: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  followSwitchText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
  },
  zoomGroup: {
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: '#ffffff',
  },
  zoomButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonTop: {
    borderRightWidth: 1,
    borderRightColor: colors.neutral[200],
  },
  zoomButtonText: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[800],
    lineHeight: 24,
  },
  screenReaderOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
