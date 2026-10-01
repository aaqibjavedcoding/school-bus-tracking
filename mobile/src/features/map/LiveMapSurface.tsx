import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type NativeSyntheticEvent } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type InitialViewState,
  type LayerSpecification,
  type MapProps,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import {
  MAP_3D_PITCH,
  MAP_MAX_PITCH,
  type MapDimension,
  type MapFallbackReason,
} from '@school-bus-tracking/map-assets';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import '../../lib/runtime-env.ts';
import { getRuntime } from '../../lib/runtime-environment.ts';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BusMarker } from './BusMarker';
import type { BusMotionFix } from './bus-motion.ts';
import { SINGLE_POINT_ZOOM, initialCameraFor } from './fit-camera.ts';
import { useMapStyle } from './use-map-style';
import { mapSurfaceMode } from './map-surface-mode';
import { NeedsDevBuildPanel } from './needs-dev-build-panel';
import type { RouteSnapPoint } from './route-snap.ts';
import type { RenderedMarker } from './useBusMarkerMotion';
import { driverFollowControls } from './map-controls.ts';
import { useFollowCamera } from './useFollowCamera';
import { GestureIsland } from '../../components/gesture-island';
import { stopsLayerCollection, type StopLayerStop } from './stop-layer.ts';
import { buildArrivalZoneCenter, buildArrivalZonePolygon } from '../crew/trip-map-geometry.ts';
import { MapLegend } from './MapLegend';
import { useMapCameraMode } from './useMapCameraMode';

/**
 * MapLibre renders its children (Camera, sources, layers, annotations) by
 * spreading its props onto the native view, so children work at runtime. In
 * this monorepo the package hoists above `react-native`, so tsc cannot
 * resolve the RN `ViewProps` the component's prop type extends and silently
 * drops `children` from it — restore that one prop here rather than fight
 * the hoisted layout.
 */
const MapView = Map as unknown as React.ComponentType<MapProps & { children?: React.ReactNode }>;

/**
 * The ONE live-map surface — everything the driver map and the observer map
 * (admin, parent, conductor) share, in one component with a
 * `variant: 'driver' | 'observer'` prop.
 *
 * ### Why this file exists
 *
 * The driver map (`features/crew/DriverTripMap`) grew the full driving-time
 * surface — gesture ownership inside a ScrollView (`GestureIsland` + the
 * explicit `dragPan`/`touchZoom`/`doubleTapZoom` props), one-hand zoom
 * buttons, the follow primary + switch, fullscreen, the next-stop highlight
 * and the arrival-zone ring — while the observer map (`features/map/BusMap`)
 * kept a bare map with a single recenter chip. Admin, parent and (as of the
 * conductor split) conductor screens now render THIS component, so a fix to
 * any of those behaviours lands for every role at once. The wrappers own only
 * what is genuinely theirs:
 *
 * - **driver** (`DriverTripMap`): the GPS honesty panel and its no-fix CTA,
 *   the trail and planned-legs lines, the next-stop driving line;
 * - **observer** (`BusMap`): the freshness panel (live / last known / no
 *   position — the socket's words, never the driver's "your device" line).
 *
 * ### The control policy is not forked
 *
 * Both variants read the SAME pure policy modules — `map-controls.ts` (zoom
 * step/bounds and the follow-control state machine) and `useFollowCamera`
 * (the camera controller binding) — so "what the buttons do" and "what the
 * camera does" each have exactly one definition. Only the paint of the route
 * line differs (the driver de-emphasises it because the trail and planned
 * lines carry the real information; the observer has no other line, so the
 * route stays the primary colour).
 *
 * ### The stops are ONE layer
 *
 * The stops render as a single GeoJSON source with a circle layer (the dot)
 * and a symbol layer (the always-visible label), not per-stop
 * `ViewAnnotation`s — on Android each annotation is an offscreen bitmap
 * rasterisation, so a 30-stop route used to pay for thirty of them. The
 * next-stop highlight is a data-driven paint property on that one layer
 * (see `stop-layer.ts`).
 */

/** Which role's surface this is — decides paint and which extras render. */
export type LiveMapVariant = 'driver' | 'observer';

export interface LiveMapSurfaceProps {
  variant: LiveMapVariant;
  /** The trip's stops, in order. Coordinates are optional on the API shape. */
  stops: StopResponse[];
  /**
   * The position to draw. Driver: this device's newest own fix. Observer: the
   * fix streamed over the socket — never the viewer's own GPS.
   */
  fix: BusMotionFix | null;
  /** Changing trip drops the previous bus's rendered position. */
  tripId?: string | null;
  /**
   * Height of the embedded card. The floor is 240 dp: below that a pinch has
   * no room to resolve and the map reads as a thumbnail.
   */
  height?: number;
  /**
   * The next stop's id, from the screen's own progress/ETA derivation — the
   * map never chooses a highlight itself. Drives the amber pin and the
   * arrival-zone ring for BOTH variants; `null` draws every stop plain.
   */
  nextStopId?: string | null;
  /** The driven path (driver variant only; the observer passes nothing). */
  trailFeature?: Feature<LineString> | null;
  /** The planned stop order ahead (driver variant only). */
  plannedFeature?: Feature<LineString> | null;
  /** The GPS accuracy circle, already derived by the wrapper's presentation. */
  accuracyCircleFeature?: Feature<Polygon> | null;
  /** Whether the marker may animate (the wrapper's freshness verdict). */
  animate?: boolean;
  busTitle?: string;
  busDescription?: string;
  /**
   * The top-left status panel, owned by the wrapper (driver honesty panel /
   * observer freshness panel). Rendered above every surface mode — the
   * position's freshness is true even when the tiles are not.
   */
  panel?: React.ReactNode;
  /**
   * The card-header line above the map (driver: the next-stop summary;
   * observer: the bus title).
   */
  headerTitle?: string | null;
  /**
   * Runs when fullscreen opens — the driver variant re-reads the trail there
   * (fullscreen is a remount, so it is also the freshest moment to refresh).
   */
  onExpandStart?: () => void;
}

/**
 * Padding that keeps markers off the edge when the route is fitted.
 */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/**
 * The floor for the embedded card, in dp — the smallest height at which the
 * card is still a *map* rather than a thumbnail (and the driver has Full
 * screen for anything more).
 */
export const LIVE_MAP_MIN_HEIGHT = 240;

/**
 * School-bus amber with an explicit alpha — `rgba()` rather than an 8-digit
 * hex because it is parsed identically by style-spec paint properties on both
 * platforms. Identical on both variants so a coarse fix looks the same
 * everywhere.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

/**
 * The next stop's **arrival zone** — the circle the server's arrival engine
 * actually evaluates (effective radius: the server's
 * `effective_radius_meters`). Drawn ONLY around the next stop, as a THIN
 * DASHED RING with a solid dot at the surveyed coordinate — deliberately
 * unlike the GPS accuracy circle (solid light-amber, centred on the bus).
 * PR #193's rendering, kept byte-for-byte for both variants.
 */
const ZONE_STROKE = 'rgba(180, 83, 9, 0.9)';
/** The surveyed stop coordinate itself — a small solid dot inside the ring. */
const ZONE_CENTER_DOT = 'rgb(180, 83, 9)';

/** Trail and planned-legs paint, stated once for the map. */
const TRAIL_PAINT = {
  'line-color': colors.status.success,
  'line-width': 3,
  'line-dasharray': [1.5, 1.5] as number[],
};
const PLANNED_PAINT = {
  'line-color': colors.primary[600],
  'line-width': 4,
};

function fallbackNoticeMessage(reason: MapFallbackReason): string {
  return reason === 'reduced-motion'
    ? t('map.performance.reducedMotion')
    : t('map.performance.droppedFrames');
}

/** The style-spec paint object of a line layer, for the shared constants. */
type LinePaint = Extract<LayerSpecification, { type: 'line' }>['paint'];

/**
 * The route line's paint, by variant. The driver's route is the de-emphasised
 * neutral dotted line (the green trail and amber planned lines carry the
 * information); the observer's route is the primary dashed line, as it always
 * was on the parent/admin map.
 */
const ROUTE_PAINT: Record<LiveMapVariant, LinePaint> = {
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

interface SurfaceProps {
  variant: LiveMapVariant;
  stopsCollection: FeatureCollection<Point> | null;
  routeLineFeature: Feature<LineString> | null;
  /** The stops in order — the marker's display-only snap target (R4). */
  route: readonly RouteSnapPoint[];
  trailFeature: Feature<LineString> | null;
  plannedFeature: Feature<LineString> | null;
  accuracyCircleFeature: Feature<Polygon> | null;
  /** The next stop's arrival-zone ring (effective radius), or null. */
  arrivalZoneFeature: Feature<Polygon> | null;
  /** The next stop's exact surveyed coordinate, drawn as a small dot. */
  arrivalZoneCenterFeature: Feature<Point> | null;
  initialCamera: InitialViewState | null;
  /** From `useMapStyle`: the URL, or the glyph-repaired style object. */
  mapStyle: MapProps['mapStyle'];
  fix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  dimension: MapDimension;
  animate: boolean;
  busTitle: string;
  busDescription: string;
  onFrame: (marker: RenderedMarker) => void;
  onRegionChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onRegionChangeComplete: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onMapReady: () => void;
  onRenderFrame: () => void;
  /** From `useMapStyle`: the engine's failure/recovery hooks (R3). */
  onStyleLoadFailed: () => void;
  onStyleLoaded: () => void;
  cameraRef: React.RefObject<CameraRef | null>;
  /**
   * Declared so the memo compares it — busting the cache on a language switch
   * so the stop labels re-translate — but deliberately NOT destructured.
   */
  locale: string;
}

/**
 * Memoised so the 5 s status tick and the surrounding screen's state cannot
 * reach the native map. Every prop is either stable per trip or changes only
 * when the data genuinely changes.
 */
const LiveMapSurfaceMap: React.FC<SurfaceProps> = React.memo(
  ({
    variant,
    stopsCollection,
    routeLineFeature,
    route,
    trailFeature,
    plannedFeature,
    accuracyCircleFeature,
    arrivalZoneFeature,
    arrivalZoneCenterFeature,
    initialCamera,
    fix,
    tripId,
    reducedMotion,
    dimension,
    animate,
    busTitle,
    busDescription,
    onFrame,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    onRenderFrame,
    onStyleLoadFailed,
    onStyleLoaded,
    cameraRef,
    mapStyle,
  }) => (
    <MapView
      style={styles.map}
      mapStyle={mapStyle}
      // OSM-derived tiles legally require the attribution and the logo;
      // MapLibre renders both in the BOTTOM corners, so the panel lives
      // top-left.
      attribution
      logo
      // Gesture ownership, half one (half two is `<GestureIsland>` around the
      // card). These four are documented as defaulting to `true`, but on
      // Android the native view keeps `scrollEnabled` as a *tri-state* field
      // that stays `null` until the prop is actually sent — and it only calls
      // `requestDisallowInterceptTouchEvent(true)` (the call that stops the
      // screen's ScrollView stealing the drag) while that field is `true`.
      // Sending them explicitly is what turns the engine's own ownership path
      // on; `features/map/maplibre-runtime.spec.ts` pins that behaviour
      // against the installed version.
      dragPan
      touchZoom
      doubleTapZoom
      // Rotation stays off for every role. Pitch gestures are available only
      // in an observer's explicit 3D mode; the driver remains locked exactly as
      // before, even if they deliberately choose the pitched camera.
      touchRotate={false}
      touchPitch={variant === 'driver' ? false : dimension === '3d'}
      onRegionIsChanging={onRegionChange}
      onRegionDidChange={onRegionChangeComplete}
      onDidFinishRenderingFrame={onRenderFrame}
      // The style pipeline sees the load result first: a successful load is
      // what clears the styleLoad line (R3), then the camera re-fits.
      onDidFinishLoadingMap={() => {
        onStyleLoaded();
        onMapReady();
      }}
      onDidFailLoadingMap={onStyleLoadFailed}
    >
      {/* Uncontrolled after the initial state; imperative via cameraRef. */}
      <Camera
        ref={cameraRef}
        initialViewState={{
          ...(initialCamera ?? {}),
          pitch: dimension === '3d' ? MAP_3D_PITCH : 0,
        }}
      />

      {routeLineFeature ? (
        <GeoJSONSource id="sbt-route" data={routeLineFeature}>
          <Layer type="line" id="sbt-route-line" source="sbt-route" paint={ROUTE_PAINT[variant]} />
        </GeoJSONSource>
      ) : null}

      {/* The driven path — recorded fixes only, never inferred. */}
      {trailFeature ? (
        <GeoJSONSource id="sbt-trail" data={trailFeature}>
          <Layer type="line" id="sbt-trail-line" source="sbt-trail" paint={TRAIL_PAINT} />
        </GeoJSONSource>
      ) : null}

      {/* The planned stop order ahead — the caption under the map says it is
          not the road route. */}
      {plannedFeature ? (
        <GeoJSONSource id="sbt-planned" data={plannedFeature}>
          <Layer type="line" id="sbt-planned-line" source="sbt-planned" paint={PLANNED_PAINT} />
        </GeoJSONSource>
      ) : null}

      {/* Uncertainty drawn rather than asserted. Centred on the reported fix,
          not on the interpolated marker, because the radius belongs to the
          measurement. */}
      {accuracyCircleFeature ? (
        <GeoJSONSource id="sbt-accuracy" data={accuracyCircleFeature}>
          <Layer
            type="fill"
            id="sbt-accuracy-fill"
            source="sbt-accuracy"
            paint={{ 'fill-color': ACCURACY_FILL }}
          />
          <Layer
            type="line"
            id="sbt-accuracy-stroke"
            source="sbt-accuracy"
            paint={{ 'line-color': ACCURACY_STROKE, 'line-width': 1 }}
          />
        </GeoJSONSource>
      ) : null}

      {/* The next stop's arrival zone: the SAME effective-radius circle the
          server's arrival engine evaluates, so "inside" on the map is
          "inside" to the engine. Drawn for the next stop only; the accuracy
          circle above belongs to the bus, this one belongs to the stop. */}
      {arrivalZoneFeature ? (
        <GeoJSONSource id="sbt-arrival-zone" data={arrivalZoneFeature}>
          {/* A THIN DASHED RING, no fill. The old heavy filled disc read as
              "the stop is this whole blob"; the precise stop is the dot
              below, and the ring is only the edge of the recording zone. */}
          <Layer
            type="line"
            id="sbt-arrival-zone-stroke"
            source="sbt-arrival-zone"
            paint={{
              'line-color': ZONE_STROKE,
              'line-width': 1.5,
              'line-opacity': 0.55,
              'line-dasharray': [3, 3],
            }}
          />
        </GeoJSONSource>
      ) : null}

      {arrivalZoneCenterFeature ? (
        <GeoJSONSource id="sbt-arrival-zone-center" data={arrivalZoneCenterFeature}>
          <Layer
            type="circle"
            id="sbt-arrival-zone-center-dot"
            source="sbt-arrival-zone-center"
            paint={{
              'circle-radius': 4,
              'circle-color': ZONE_CENTER_DOT,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* The stops: ONE source, one circle layer (the dot) and one symbol
          layer (the always-visible label) — see `stop-layer.ts`. The kinds
          are data-driven paint, so highlighting the next stop re-styles one
          layer instead of re-rendering N annotations. */}
      {stopsCollection ? (
        <GeoJSONSource id="sbt-stops" data={stopsCollection}>
          <Layer
            type="circle"
            id="sbt-stops-dot"
            source="sbt-stops"
            paint={{
              'circle-radius': ['case', ['==', ['get', 'kind'], 'next'], 9, 5.5],
              'circle-color': [
                'case',
                ['==', ['get', 'kind'], 'next'],
                colors.primary[600],
                colors.neutral[700],
              ],
              'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'next'], 2.5, 2],
              'circle-stroke-color': '#ffffff',
            }}
          />
          <Layer
            type="symbol"
            id="sbt-stops-label"
            source="sbt-stops"
            layout={{
              // Explicit, because a symbol layer without a `text-font` falls
              // back to MapLibre's default stack, whose OpenFreeMap font URL
              // 404s and leaves every label glyph-less (map-style.ts →
              // "Glyph / label health").
              'text-font': ['Noto Sans Regular'],
              'text-field': ['get', 'label'],
              'text-size': 13,
              'text-anchor': 'left',
              'text-offset': [1, 0],
              'text-max-width': 7,
              'text-optional': true,
            }}
            paint={{
              'text-color': colors.neutral[900],
              'text-halo-color': 'rgba(255, 255, 255, 0.92)',
              'text-halo-width': 1.5,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* Rendered after the stops so the bus draws above them (tree order is
          the annotation z-order). */}
      {fix ? (
        <BusMarker
          fix={fix}
          tripId={tripId}
          reducedMotion={reducedMotion}
          animate={animate}
          route={route}
          title={busTitle}
          description={busDescription}
          onFrame={onFrame}
        />
      ) : null}
    </MapView>
  ),
);
LiveMapSurfaceMap.displayName = 'LiveMapSurfaceMap';

export const LiveMapSurface: React.FC<LiveMapSurfaceProps> = ({
  variant,
  stops,
  fix,
  tripId = null,
  height = LIVE_MAP_MIN_HEIGHT,
  nextStopId = null,
  trailFeature = null,
  plannedFeature = null,
  accuracyCircleFeature = null,
  animate = false,
  busTitle,
  busDescription = '',
  panel = null,
  headerTitle = null,
  onExpandStart,
}) => {
  const reducedMotion = useReducedMotion();
  const { dimension, threeDUnavailable, fallbackNotice, setPreferredDimension, recordRenderFrame } =
    useMapCameraMode(reducedMotion);
  const locale = useLocale();
  const [legendOpen, setLegendOpen] = useState(false);
  // `t()` reads module state, so subscribing is what makes a language switch
  // re-render this component.
  useTranslation();

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

  // The stops as ONE layer. `locale` is a dependency because the labels are
  // baked into the collection, already localised — `t()` reads module state,
  // so a language switch must bust this cache for the labels to re-translate.
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

  // The next stop's arrival-zone ring: the effective radius the SERVER
  // returned (`effective_radius_meters`) around the stop the whole screen
  // already agrees is next. Only the next stop gets a zone, so a ten-stop
  // route stays readable; the caption under the map names what the ring
  // means. Both variants draw it — PR #193's rendering, unchanged.
  const arrivalZoneFeature = useMemo<Feature<Polygon> | null>(
    () => buildArrivalZonePolygon(stops, nextStopId),
    [stops, nextStopId],
  );

  // …and the surveyed coordinate itself, so the precise stop is visible as a
  // dot rather than implied by the middle of a blob.
  const arrivalZoneCenterFeature = useMemo<Feature<Point> | null>(
    () => buildArrivalZoneCenter(stops, nextStopId),
    [stops, nextStopId],
  );

  // Follow is explicit, not a side effect: the camera follows the bus until
  // the viewer turns it off (or pans), and off means off — the frame stream
  // stops moving the camera entirely until it is turned back on.
  const [followEnabled, setFollowEnabled] = useState(true);
  const followEnabledRef = useRef(true);
  const toggleFollow = useCallback(() => {
    setFollowEnabled((previous) => {
      const next = !previous;
      followEnabledRef.current = next;
      return next;
    });
  }, []);

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

  const applyDimensionPitch = useCallback(
    (duration = reducedMotion ? 0 : 280) => {
      void cameraRef.current?.setStop({
        pitch: dimension === '3d' ? MAP_3D_PITCH : 0,
        duration,
      });
    },
    [cameraRef, dimension, reducedMotion],
  );
  useEffect(() => {
    applyDimensionPitch();
  }, [applyDimensionPitch]);

  // The native binding has no maxPitch prop. Its engine defaults to 60; this
  // guard makes the product limit explicit and also pins 2D to a flat camera.
  const onDimensionRegionChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const pitch = event.nativeEvent.pitch;
      if (dimension === '2d' && Math.abs(pitch) > 0.1) {
        void cameraRef.current?.setStop({ pitch: 0, duration: 0 });
      } else if (pitch > MAP_MAX_PITCH) {
        void cameraRef.current?.setStop({ pitch: MAP_MAX_PITCH, duration: 0 });
      }
      onRegionChange(event);
    },
    [cameraRef, dimension, onRegionChange],
  );
  const onDimensionMapReady = useCallback(() => {
    onMapReady();
    applyDimensionPitch(0);
  }, [applyDimensionPitch, onMapReady]);
  const onRenderFrame = useCallback(() => {
    recordRenderFrame(
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now(),
    );
  }, [recordRenderFrame]);

  // The gate lives in the frame callback (a ref read), so turning follow off
  // re-renders nothing native and re-enabling pans back via `recenter()`.
  const onFollowFrame = useCallback(
    (marker: RenderedMarker) => {
      if (!followEnabledRef.current) return;
      onFrame(marker);
    },
    [onFrame],
  );
  /**
   * The primary control, in one function: follow is switched back on if it was
   * off, and the camera re-centres on the marker either way. It is safe to
   * press while already following — that is the point, because a bus that has
   * drifted under the minimum-shift threshold leaves the camera slightly off
   * and the viewer's instinct is to tap the button, not to wait.
   */
  const turnFollowOn = useCallback(() => {
    if (!followEnabledRef.current) toggleFollow();
    recenter();
  }, [toggleFollow, recenter]);

  /**
   * What the control block shows, decided by the pure policy
   * (`map-controls.ts`) rather than inline in the JSX — three states across
   * two buttons is exactly the kind of thing that drifts when it lives in a
   * render function. ONE definition, shared by both variants.
   */
  const controls = driverFollowControls({
    hasFix: fix !== null,
    followEnabled,
    exploring,
  });

  const initialCamera = useMemo(() => {
    const points: Array<{ latitude: number; longitude: number }> = [...routeCoordinates];
    if (fix) points.push({ latitude: fix.latitude, longitude: fix.longitude });
    return initialCameraFor(points);
    // Keyed on stops only: `initialViewState` is read once by the engine, and
    // recomputing it per fix would be a controlled camera in disguise.
    // (`fix` is read inside but deliberately not a dependency, for the same
    // reason the old `initialRegion` was keyed on stops alone.)
  }, [routeCoordinates]);

  // Which surface fills the map's box: tiles, the labelled development-build
  // panel, or the empty-route state (Expo Go carries no map engine on any
  // platform — see `map-surface-mode.ts`).
  const surfaceMode = mapSurfaceMode(getRuntime(), routeCoordinates.length > 0, !!fix);

  // Fullscreen is a remount (the engine reads its initial camera once), so it
  // is also the moment the driver's trail is re-read — see `onExpandStart`.
  const [expanded, setExpanded] = useState(false);
  const openFullscreen = useCallback(() => {
    setExpanded(true);
    onExpandStart?.();
  }, [onExpandStart]);
  const closeFullscreen = useCallback(() => setExpanded(false), []);

  const { mapStyle, onStyleLoadFailed, notifyStyleLoaded } = useMapStyle(undefined, dimension);

  const mapSurfaceEl = (
    <LiveMapSurfaceMap
      variant={variant}
      stopsCollection={stopsCollection}
      routeLineFeature={routeLineFeature}
      route={routeCoordinates}
      trailFeature={trailFeature}
      plannedFeature={plannedFeature}
      accuracyCircleFeature={accuracyCircleFeature}
      arrivalZoneFeature={arrivalZoneFeature}
      arrivalZoneCenterFeature={arrivalZoneCenterFeature}
      initialCamera={initialCamera}
      fix={fix}
      tripId={tripId}
      reducedMotion={reducedMotion}
      dimension={dimension}
      animate={animate}
      busTitle={busTitle ?? t('map.busA11y')}
      busDescription={busDescription}
      onFrame={onFollowFrame}
      onRegionChange={onDimensionRegionChange}
      onRegionChangeComplete={onRegionChangeComplete}
      onMapReady={onDimensionMapReady}
      onRenderFrame={onRenderFrame}
      onStyleLoadFailed={onStyleLoadFailed}
      onStyleLoaded={notifyStyleLoaded}
      cameraRef={cameraRef}
      mapStyle={mapStyle}
      locale={locale}
    />
  );

  // Honest line explanations now live behind the info affordance rather than
  // as permanent duplicate copy below the map.
  const plannedOrderDetail = plannedFeature ? t('map.plannedNotice') : t('map.routeNotice');
  const zoneDetail = arrivalZoneFeature ? t('map.arrivalZoneNotice') : null;
  const fallbackMessage = fallbackNotice ? fallbackNoticeMessage(fallbackNotice) : null;

  const headerLine = headerTitle ?? busTitle ?? t('map.busA11y');

  const overlays = (fullHeight: boolean) => (
    <>
      {/* The wrapper's status panel (top-left, clear of the MapLibre
          attribution and logo in the bottom corners). Kept on every surface —
          the position's freshness is true even when the tiles are not. */}
      {panel}

      <View style={[styles.controls, fullHeight ? styles.controlsFull : null]}>
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

        {/* One primary, one meaning: re-centre on the bus and follow it.
            Never a toggle — a primary that turned follow OFF while following
            is what made the old block read as broken (P1-6). */}
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

        {/* The follow switch itself: visually distinct (small, muted), and the
            only control that can turn following off. With follow off it is a
            state pill, not a second way back on — that is the primary. */}
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

        {/* Zoom, for one hand. A press is a programmatic camera move, so it
            does NOT leave follow mode (`follow-camera-controller.ts`). */}
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

      {/* The follow state is invisible to a screen reader unless spoken. */}
      <Text accessibilityLiveRegion="polite" style={styles.screenReaderOnly}>
        {t(controls.stateKey)}
      </Text>
    </>
  );

  if (surfaceMode === 'no-coordinates') {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>{t('map.noCoordinates')}</Text>
      </View>
    );
  }

  /**
   * The map box.
   *
   * Two things that look like details and are not:
   *
   * 1. **`wrapFull` carries `flex: 1`.** Every child here is absolutely
   *    positioned — the MapView is `StyleSheet.absoluteFill`, the panel and
   *    the controls are `position: 'absolute'` — so the wrapper has no
   *    intrinsic height at all. In the embedded card an explicit `height`
   *    supplies it; inside the fullscreen `Modal` there was none, so the
   *    wrapper measured **0** and the Full Map screen showed a header, two
   *    captions and white (P1-3). `flex: 1` is what gives it the modal's
   *    remaining space.
   * 2. **`<GestureIsland>` owns the touches.** It disables the surrounding
   *    `<Screen>` ScrollView while a finger is inside the map, so a pan or a
   *    pinch that starts on the map is not stolen by the page (P1-5) — the
   *    exact defect that was live for admin and parent until this component
   *    became their map. It is inert in fullscreen (no scroll view above it)
   *    and inert on the dev-build placeholder, which has no gestures to own.
   */
  const mapBody = (fullHeight: boolean) => (
    <GestureIsland
      enabled={surfaceMode === 'map'}
      style={[styles.wrap, fullHeight ? styles.wrapFull : { height }]}
    >
      {surfaceMode === 'needs-dev-build' ? (
        // The driver's GPS still works in Expo Go — only the map engine is
        // missing, so the panel names that instead of showing a blank box.
        <NeedsDevBuildPanel />
      ) : (
        mapSurfaceEl
      )}
      {overlays(fullHeight)}
    </GestureIsland>
  );

  return (
    <View style={styles.card}>
      {/* The header line answers "what am I looking at" before the map box,
          so the fact survives even when the tiles do not. */}
      <View style={styles.cardHeader}>
        <Text style={styles.headerLineText} numberOfLines={2}>
          {headerLine}
        </Text>
        {surfaceMode === 'map' ? (
          <Pressable
            onPress={openFullscreen}
            accessibilityRole="button"
            accessibilityLabel={t('map.expand')}
            hitSlop={6}
            style={({ pressed }) => [styles.expandButton, pressed ? styles.followPressed : null]}
          >
            <Text style={styles.followButtonText}>{t('map.expand')}</Text>
          </Pressable>
        ) : null}
      </View>

      {surfaceMode === 'map' && expanded ? (
        <Modal animationType="slide" onRequestClose={closeFullscreen} accessibilityViewIsModal>
          <View style={styles.fullscreen}>
            <View style={styles.fullscreenHeader}>
              <Text style={styles.fullscreenTitle} numberOfLines={1}>
                {headerLine}
              </Text>
              <Pressable
                onPress={closeFullscreen}
                accessibilityRole="button"
                accessibilityLabel={t('map.exitFullscreen')}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.followButton,
                  pressed ? styles.followPressed : null,
                ]}
              >
                <Text style={styles.followButtonText}>{t('map.exitFullscreen')}</Text>
              </Pressable>
            </View>
            {mapBody(true)}
          </View>
        </Modal>
      ) : (
        mapBody(false)
      )}

      {/* No permanent legend below the map: the compact info affordance owns
          those explanations, leaving the bottom corners to provider chrome. */}
    </View>
  );
};

const styles = StyleSheet.create({
  /**
   * The card owns the gap to whatever follows it. `Screen` only pads its
   * edges — it puts no space between its children — so every card on a
   * tracking screen carries its own bottom margin, and one that forgets ends
   * up flush against the next control (the same class of bug as the SOS
   * button, P1-4).
   */
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
  expandButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  fullscreen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  fullscreenTitle: {
    flex: 1,
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.primary[700],
  },
  wrap: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  /**
   * Fullscreen has no explicit height to give, and every child of the wrapper
   * is absolutely positioned, so without this the modal's map measured 0 dp
   * high and the Full Map screen rendered as a header on white (P1-3).
   */
  wrapFull: {
    flex: 1,
    borderRadius: 0,
    borderWidth: 0,
  },
  map: {
    // RN 0.86 (Expo SDK 57) removed `StyleSheet.absoluteFillObject`; the
    // frozen `StyleSheet.absoluteFill` object is the single replacement.
    ...StyleSheet.absoluteFill,
  },
  controls: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    alignItems: 'flex-end',
    gap: spacing.xs,
    maxWidth: '40%',
  },
  controlsFull: {
    // In fullscreen the header row above the map holds the exit button; the
    // follow controls drop below it so they never overlap it.
    top: spacing.xl,
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
    fontSize: typography.fontSizes.xs,
    fontWeight: '600',
    color: colors.neutral[600],
    textAlign: 'right',
  },
  /** Disabled controls stay readable — greyed, never invisible. */
  controlDisabled: {
    opacity: 0.55,
  },
  followButton: {
    // 44 dp is the minimum comfortable touch target on both platforms.
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
  /** Following and on the bus: the primary is filled, not just labelled. */
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
  /**
   * The follow switch: deliberately smaller and quieter than the primary, so
   * the two controls can never be mistaken for each other.
   */
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
  /** +/− stacked as one control, so the pair reads as a zoom widget. */
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
    // The glyphs are centred by the box; a line height stops "+" sitting high.
    lineHeight: 24,
  },
  screenReaderOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  placeholder: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  placeholderText: {
    color: colors.neutral[600],
    fontSize: typography.fontSizes.sm,
    textAlign: 'center',
  },
});
