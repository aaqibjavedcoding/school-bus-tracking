import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type InitialViewState,
  type MapProps,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { Feature, LineString, Polygon } from 'geojson';
import type {
  StopResponse,
  TripLocationHistoryResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import '../../lib/runtime-env.ts';
import { getRuntime } from '../../lib/runtime-environment.ts';
import {
  formatDistanceMeters,
  formatEtaMinutes,
  formatRelative,
  formatSpeedKmh,
  formatTime,
} from '../../lib/format';
import { useLoad } from '../../hooks/useLoad';
import { apiClient } from '../../services/api';
import { unwrapEnvelope } from '../../lib/errors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BusMarker } from '../map/BusMarker';
import { StopMarker } from '../map/StopMarker';
import { accuracyCirclePolygon } from '../map/accuracy-circle';
import type { BusMotionFix } from '../map/bus-motion.ts';
import { SINGLE_POINT_ZOOM, initialCameraFor } from '../map/fit-camera.ts';
import { MapIssueLines } from '../map/map-issue-lines';
import { useMapStyle } from '../map/use-map-style';
import { mapSurfaceMode } from '../map/map-surface-mode';
import { NeedsDevBuildPanel } from '../map/needs-dev-build-panel';
import type { RouteSnapPoint } from '../map/route-snap.ts';
import type { RenderedMarker } from '../map/useBusMarkerMotion';
import { driverFollowControls } from '../map/map-controls.ts';
import { useFollowCamera } from '../map/useFollowCamera';
import { GestureIsland } from '../../components/gesture-island';
import {
  buildArrivalZonePolygon,
  buildPlannedLegsLine,
  buildTrailLine,
  historyFixesForTrip,
} from './trip-map-geometry.ts';
import {
  driverMapCopy,
  driverMapNoFixLabel,
  driverStopMarkerKind,
  type DriverMapNoFixAction,
  type DriverMapNoFixCta,
  type DriverMapPresentation,
} from './crew-map-presentation.ts';

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
 * The **Driver Trip** map: where this driver is, on their own run.
 *
 * ### Supplementary by design
 *
 * This is not turn-by-turn navigation, and it must never become a screen the
 * driver has to operate while moving. It is one card: the route's stops, this
 * device's own position, and one honest status line. The next-stop card and the
 * external **Navigate** hand-off below it remain the driving workflow; the SOS,
 * attendance and trip-status controls stay one tap away. Nothing here is
 * required to complete a trip — losing the map costs the driver nothing.
 *
 * ### The marker's data source, stated once
 *
 * `localFix` is the newest coordinate **this device produced**
 * (`useCrewLocationSharing().stats.lastFix`). It is drawn as-is: no server
 * round trip, no second GPS watcher, no extra socket subscription. The screen's
 * existing GPS-sharing strip remains the authority for whether anyone else can
 * see it, and `presentation` (from `crew-map-presentation.ts`) carries that
 * verdict through unchanged — the map never states or implies "the school sees
 * you". When the position has not been delivered, the panel says so, in words.
 *
 * Interpolated coordinates — the ones this component animates through between
 * fixes — are presentation only. They are never written into history, ETA,
 * attendance or notifications, exactly as on the observer map.
 *
 * ### The two lines, and the honesty each one owes
 *
 * - **Trail** (dotted, green) — the path already driven, built by
 *   `buildTrailLine` from the server's recorded fixes
 *   (`GET /trips/:id/location/history`, scoped to *this* trip by
 *   `historyFixesForTrip`). The only line here allowed to be called "driven".
 * - **Planned legs** (solid, amber) — stop-to-stop straight segments from the
 *   next stop onward, built by `buildPlannedLegsLine` from the same
 *   `deriveTripProgressForTrip` next stop the card below uses. It is the
 *   **planned order, not a road route** — the platform has no routing engine —
 *   so the caption under the map says exactly that.
 *
 * The next-stop id is always an input (`nextStopId`): the marker, the card
 * line, the Navigate hand-off and the voice all read the one derivation, and
 * the map never picks a next stop of its own.
 *
 * ### The engine, and what it must never become
 *
 * Same engine and style policy as the observer map (`map-style.ts`,
 * `docs/live-tracking-map.md` → "Map provider policy"): OpenFreeMap over
 * OpenStreetMap by default, an https-only self-hosted override later, no key
 * and no billing. With no network the style load retries (bounded backoff,
 * R3) and then drops to the bundled offline base style; the marker, the stops
 * and the device position line are overlays and keep working either way.
 */
export interface DriverTripMapProps {
  /** The trip's stops, in order. Coordinates are optional on the API shape. */
  stops: StopResponse[];
  /** The newest fix from this device alone, or `null` before the first one. */
  localFix: BusMotionFix | null;
  /** Crew freshness verdict — see `deriveDriverMapPresentation`. */
  presentation: DriverMapPresentation;
  /** Changing trip drops the previous bus's rendered position. */
  tripId?: string | null;
  /**
   * Height of the embedded card. The default is the field floor: below ~240 dp
   * a pinch has no room to resolve and the map reads as a thumbnail rather
   * than something to operate.
   */
  height?: number;
  /**
   * The repair the panel offers while no position exists, decided by
   * `driverMapNoFixCta` from the **GPS strip's own** action — the map never
   * invents a second recovery mechanism. `null` shows no button.
   */
  noFixCta?: DriverMapNoFixCta | null;
  /** Runs the CTA. The screen owns the actions (`useCrewLocationSharing`). */
  onNoFixAction?: (action: DriverMapNoFixAction) => void;
  /** The sharing lifecycle is busy: the CTA must not be tapped twice. */
  busy?: boolean;
  /**
   * The next stop's id, from `deriveTripProgressForTrip(...).nextStop?.id` —
   * the same derivation the navigation card and the kids card read. `null`
   * draws every stop plain; the map never chooses a highlight itself.
   */
  nextStopId?: string | null;
  /** The next stop's name, for the driving line on the card. */
  nextStopName?: string | null;
  /** Server-computed distance to the next stop (`eta.next_stop`). */
  nextStopDistanceMeters?: number | null;
  /** Server-computed ETA to the next stop, in minutes (`eta.next_stop`). */
  nextStopEtaMinutes?: number | null;
}

/**
 * Padding that keeps markers off the edge when the route is fitted.
 */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/**
 * The floor for the embedded card, in dp.
 *
 * The screen used to pass 200, which is about six rows of map either side of
 * the marker: a pinch has nowhere to resolve, the follow controls and the
 * honesty panel take a third of it, and everything reads as a thumbnail. 240
 * is the smallest height at which the card is still a *map* — and the driver
 * has Full screen for anything more.
 */
export const EMBEDDED_MAP_MIN_HEIGHT = 240;

/**
 * How many recorded fixes the trail reads per load (the endpoint caps at 500;
 * 200 breadcrumb points bound the payload while covering most of a run).
 */
const TRAIL_FIX_LIMIT = 200;

/**
 * School-bus amber with an explicit alpha — `rgba()` rather than an 8-digit
 * hex because it is parsed identically by style-spec paint properties on both
 * platforms. Identical to the observer map's circle so a coarse fix looks the
 * same on both.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

/**
 * The next stop's **arrival zone** — the circle the server's arrival engine
 * actually evaluates (effective radius: stored radius floored at 50 m).
 *
 * Deep-fix R1: the zone used to be invisible, so a driver parked inside it
 * had no way to tell "almost there" from "the app is broken". It is drawn
 * ONLY around the next stop (the map stays clean) and deliberately unlike
 * the GPS accuracy circle: a DASHED darker-amber ring with barely-there fill
 * centred on the stop, where the accuracy circle is a solid light-amber ring
 * centred on the bus. When the bus is inside the zone the two overlap — dash
 * vs solid is what keeps them readable apart.
 */
const ZONE_STROKE = 'rgba(180, 83, 9, 0.9)';
const ZONE_FILL = 'rgba(245, 158, 11, 0.06)';

/** Trail and planned-legs paint, stated once for both native map instances. */
const TRAIL_PAINT = {
  'line-color': colors.status.success,
  'line-width': 3,
  'line-dasharray': [1.5, 1.5] as number[],
};
const PLANNED_PAINT = {
  'line-color': colors.primary[600],
  'line-width': 4,
};

interface SurfaceProps {
  stops: Array<StopResponse & { latitude: number; longitude: number }>;
  routeLineFeature: Feature<LineString> | null;
  /** The stops in order — the marker's display-only snap target (R4). */
  route: readonly RouteSnapPoint[];
  trailFeature: Feature<LineString> | null;
  plannedFeature: Feature<LineString> | null;
  accuracyCircleFeature: Feature<Polygon> | null;
  /** The next stop's arrival-zone circle (effective radius), or null. */
  arrivalZoneFeature: Feature<Polygon> | null;
  initialCamera: InitialViewState | null;
  /** From `useMapStyle`: the URL, or the glyph-repaired style object. */
  mapStyle: MapProps['mapStyle'];
  localFix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  animate: boolean;
  busTitle: string;
  busDescription: string;
  /** The next stop's id — the only stop drawn with the big amber pin. */
  nextStopId: string | null;
  /**
   * Declared so the memo compares it — busting the cache on a language switch
   * so the callouts re-translate — but deliberately NOT destructured.
   */
  locale: string;
  onFrame: (marker: RenderedMarker) => void;
  onRegionChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onRegionChangeComplete: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onMapReady: () => void;
  /** From `useMapStyle`: the engine's failure/recovery hooks (R3). */
  onStyleLoadFailed: () => void;
  /** From `useMapStyle`: a fully rendered frame clears the issue lines. */
  onTilesRendered: () => void;
  onStyleLoaded: () => void;
  cameraRef: React.RefObject<CameraRef | null>;
}

/**
 * Memoised so the 5 s status tick and the surrounding screen's state cannot
 * reach the native map. Every prop is either stable per trip or changes only
 * when the fix does.
 */
const DriverMapSurface: React.FC<SurfaceProps> = React.memo(
  ({
    stops,
    routeLineFeature,
    route,
    trailFeature,
    plannedFeature,
    accuracyCircleFeature,
    arrivalZoneFeature,
    initialCamera,
    localFix,
    tripId,
    reducedMotion,
    animate,
    busTitle,
    busDescription,
    nextStopId,
    onFrame,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    onStyleLoadFailed,
    onTilesRendered,
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
      // Rotate and pitch are off by choice, not by accident: a driver glancing
      // at a rotated or tilted map has to re-orient before reading it, and a
      // stray two-finger twist during a pinch is how that happens.
      touchRotate={false}
      touchPitch={false}
      onRegionIsChanging={onRegionChange}
      onRegionDidChange={onRegionChangeComplete}
      // The style pipeline sees the load result first: a successful load is
      // what clears the styleLoad line (R3), then the camera re-fits.
      onDidFinishLoadingMap={() => {
        onStyleLoaded();
        onMapReady();
      }}
      onDidFailLoadingMap={onStyleLoadFailed}
      // A frame that rendered completely is the other proof the map healed
      // itself — the one event that fires when a dead zone quietly ends.
      onDidFinishRenderingMapFully={onTilesRendered}
    >
      {/* Uncontrolled after the initial state; imperative via cameraRef. */}
      <Camera ref={cameraRef} initialViewState={initialCamera ?? undefined} />

      {routeLineFeature ? (
        <GeoJSONSource id="sbt-route" data={routeLineFeature}>
          <Layer
            type="line"
            id="sbt-route-line"
            source="sbt-route"
            paint={{
              'line-color': colors.neutral[400],
              'line-width': 2,
              'line-dasharray': [4, 4],
              'line-opacity': 0.8,
            }}
          />
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
          <Layer
            type="fill"
            id="sbt-arrival-zone-fill"
            source="sbt-arrival-zone"
            paint={{ 'fill-color': ZONE_FILL }}
          />
          <Layer
            type="line"
            id="sbt-arrival-zone-stroke"
            source="sbt-arrival-zone"
            paint={{
              'line-color': ZONE_STROKE,
              'line-width': 2,
              'line-dasharray': [3, 2],
            }}
          />
        </GeoJSONSource>
      ) : null}

      {stops.map((stop) => (
        <StopMarker
          key={stop.id}
          id={`stop-${stop.id}`}
          latitude={stop.latitude}
          longitude={stop.longitude}
          title={stop.name}
          label={t('map.stopLabel', { number: stop.sequence_number, name: stop.name })}
          description={`${t('map.stopA11y', { number: stop.sequence_number })}${
            stop.address ? ` · ${stop.address}` : ''
          }`}
          variant={driverStopMarkerKind(stop.id, nextStopId)}
        />
      ))}

      {/* Rendered after the stops so the bus draws above them (tree order is
          the annotation z-order). */}
      {localFix ? (
        <BusMarker
          fix={localFix}
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
DriverMapSurface.displayName = 'DriverMapSurface';

export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  tripId = null,
  height = EMBEDDED_MAP_MIN_HEIGHT,
  nextStopId = null,
  nextStopName = null,
  nextStopDistanceMeters = null,
  nextStopEtaMinutes = null,
  noFixCta = null,
  onNoFixAction,
  busy = false,
}) => {
  const reducedMotion = useReducedMotion();
  const locale = useLocale();
  // `t()` reads module state, so subscribing is what makes a language switch
  // re-render this component.
  useTranslation();

  const locatedStops = useMemo(
    () =>
      stops.filter(
        (stop): stop is StopResponse & { latitude: number; longitude: number } =>
          stop.latitude !== null && stop.longitude !== null,
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

  // The travelled path: the server's recorded fixes for THIS trip (the payload
  // names its trip, so a switch back/forth cannot play the wrong run's path).
  const trailLoad = useLoad<TripLocationHistoryResponse | null>(async () => {
    if (!tripId) return null;
    return unwrapEnvelope(
      await apiClient.getTripLocationHistory(tripId, { limit: TRAIL_FIX_LIMIT }),
    );
  }, [tripId]);
  const trailFeature = useMemo<Feature<LineString> | null>(
    () => buildTrailLine(historyFixesForTrip(trailLoad.data ?? null, tripId)),
    [trailLoad.data, tripId],
  );

  // The planned order ahead, from the same next stop every other surface reads.
  const plannedFeature = useMemo<Feature<LineString> | null>(
    () => buildPlannedLegsLine(stops, nextStopId),
    [stops, nextStopId],
  );

  const accuracyCircleFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!localFix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: localFix.latitude, longitude: localFix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [localFix, presentation.accuracyCircleMeters]);

  // The next stop's arrival-zone circle: the effective radius (stored radius
  // floored at 50 m — see `arrival-zone.ts`) around the stop the whole screen
  // already agrees is next. Only the next stop gets a zone, so a ten-stop
  // route stays readable; the caption under the map names what the ring means.
  const arrivalZoneFeature = useMemo<Feature<Polygon> | null>(
    () => buildArrivalZonePolygon(stops, nextStopId),
    [stops, nextStopId],
  );

  // Follow is explicit, not a side effect: the camera follows the bus until
  // the driver turns it off (or pans), and off means off — the frame stream
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
    fix: localFix ? { latitude: localFix.latitude, longitude: localFix.longitude } : null,
    tripId,
    singlePointZoom: SINGLE_POINT_ZOOM,
    edgePadding: FIT_EDGE_PADDING,
  });
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
   * and the driver's instinct is to tap the button, not to wait.
   */
  const turnFollowOn = useCallback(() => {
    if (!followEnabledRef.current) toggleFollow();
    recenter();
  }, [toggleFollow, recenter]);

  /**
   * What the control block shows, decided by the pure policy
   * (`map-controls.ts`) rather than inline in the JSX — three states across
   * two buttons is exactly the kind of thing that drifts when it lives in a
   * render function.
   */
  const controls = driverFollowControls({
    hasFix: localFix !== null,
    followEnabled,
    exploring,
  });

  // Only changes when the fix changes: a per-tick callout would re-render the
  // native surface every 5 s for a string nobody can see until they tap it.
  const busDescription = !localFix
    ? ''
    : `${formatSpeedKmh(localFix.speed)} · ${formatTime(localFix.recorded_at)}`;

  // Both lines, resolved together: the position line always, the delivery line
  // only when the school cannot see what is drawn (see `crew-map-presentation`).
  const copy = driverMapCopy(presentation, localFix ? formatRelative(localFix.recorded_at) : '');

  // The driving line on the card: the three facts a driver needs without
  // reading a list — which stop, how far, how long. All three are the
  // server's numbers; nothing is estimated here.
  const nextLine = nextStopName
    ? t('driverMap.nextSummary', {
        name: nextStopName,
        distance:
          nextStopDistanceMeters !== null ? formatDistanceMeters(nextStopDistanceMeters) : '—',
        eta: formatEtaMinutes(nextStopEtaMinutes) ?? '—',
      })
    : null;

  // The honest captions: what each drawn line is, and is not.
  const plannedNotice = plannedFeature ? t('map.plannedNotice') : null;
  const trailNotice = trailFeature ? t('map.trailNotice') : null;
  const routeNotice = !plannedNotice && routeCoordinates.length > 1 ? t('map.routeNotice') : null;
  // The zone ring's meaning is not guessable from its shape — say it once,
  // under the map, only while the ring is drawn.
  const zoneNotice = arrivalZoneFeature ? t('map.arrivalZoneNotice') : null;

  const initialCamera = useMemo(() => {
    const points: Array<{ latitude: number; longitude: number }> = [...routeCoordinates];
    if (localFix) points.push({ latitude: localFix.latitude, longitude: localFix.longitude });
    return initialCameraFor(points);
    // Keyed on stops only: `initialViewState` is read once by the engine, and
    // recomputing it per fix would be a controlled camera in disguise.
    // (`localFix` is read inside but deliberately not a dependency, for the
    // same reason the old `initialRegion` was keyed on stops alone.)
  }, [routeCoordinates]);

  // Which surface fills the map's box: tiles, the labelled development-build
  // panel, or the empty-route state (Expo Go carries no map engine on any
  // platform — see `map-surface-mode.ts`).
  const surfaceMode = mapSurfaceMode(getRuntime(), routeCoordinates.length > 0, !!localFix);

  // Fullscreen is a remount (the engine reads its initial camera once), so it
  // is also the moment the trail is re-read — the freshest path for the
  // driver's zoomed-in look.
  const [expanded, setExpanded] = useState(false);
  const openFullscreen = useCallback(() => {
    setExpanded(true);
    if (tripId) void trailLoad.refresh();
  }, [tripId, trailLoad]);
  const closeFullscreen = useCallback(() => setExpanded(false), []);

  const { mapStyle, onStyleLoadFailed, notifyStyleLoaded, notifyTilesRendered } = useMapStyle();

  const mapSurfaceEl = (
    <DriverMapSurface
      stops={locatedStops}
      routeLineFeature={routeLineFeature}
      route={routeCoordinates}
      trailFeature={trailFeature}
      plannedFeature={plannedFeature}
      accuracyCircleFeature={accuracyCircleFeature}
      arrivalZoneFeature={arrivalZoneFeature}
      initialCamera={initialCamera}
      localFix={localFix}
      tripId={tripId}
      reducedMotion={reducedMotion}
      animate={presentation.animate}
      busTitle={t('map.busA11y')}
      busDescription={busDescription}
      nextStopId={nextStopId}
      locale={locale}
      onFrame={onFollowFrame}
      onRegionChange={onRegionChange}
      onRegionChangeComplete={onRegionChangeComplete}
      onMapReady={onMapReady}
      onStyleLoadFailed={onStyleLoadFailed}
      onStyleLoaded={notifyStyleLoaded}
      onTilesRendered={notifyTilesRendered}
      cameraRef={cameraRef}
      mapStyle={mapStyle}
    />
  );

  const overlays = (fullHeight: boolean) => (
    <>
      {/* Top-left: clear of the MapLibre attribution and logo (bottom
          corners). Kept on every surface — the device's own position line
          is true even when the tiles are not. */}
      <View style={styles.panel}>
        <View style={styles.panelChips}>
          <Text style={styles.chipSource}>{t('driverMap.source')}</Text>
          {presentation.approximate ? (
            <Text style={styles.chipNeutral}>{t('map.status.approximate')}</Text>
          ) : null}
        </View>
        {/* How current the position is, always; then why the school cannot see
            it, only when that is true. */}
        <Text style={styles.panelNote}>{copy.position}</Text>
        {copy.delivery ? <Text style={styles.panelNote}>{copy.delivery}</Text> : null}
        {/* With nothing to draw, the panel offers the repair the GPS strip
            already decided on instead of leaving the driver at a dead end
            (P2-7). It never starts a mechanism of its own — every action here
            is one of the strip's, run by the screen. */}
        {noFixCta ? (
          <Pressable
            onPress={() => onNoFixAction?.(noFixCta.action)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={driverMapNoFixLabel(noFixCta)}
            accessibilityState={{ disabled: busy }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.panelCta,
              pressed ? styles.panelCtaPressed : null,
              busy ? styles.controlDisabled : null,
            ]}
          >
            <Text style={styles.panelCtaText}>{driverMapNoFixLabel(noFixCta)}</Text>
          </Pressable>
        ) : null}
        {/* Map style/label failures are visible here — never blank-silent. */}
        <MapIssueLines />
      </View>

      <View style={[styles.controls, fullHeight ? styles.controlsFull : null]}>
        {/* One primary, one meaning: re-centre on the bus and follow it.
            Never a toggle — the old block turned follow OFF from here while
            following, which is what made it read as broken (P1-6). */}
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
   *    pinch that starts on the map is not stolen by the page (P1-5). It is
   *    inert in fullscreen (no scroll view above it) and inert on the
   *    dev-build placeholder, which has no gestures to own.
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
      {/* Driving line: the card answers "what's next" before the map box, so
          the fact survives even when the tiles do not. */}
      <View style={styles.cardHeader}>
        <Text style={styles.nextLine} numberOfLines={2}>
          {nextLine ?? t('trip.nextStopFallback')}
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
                {nextLine ?? t('map.busA11y')}
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
            <View style={styles.fullscreenNotices}>
              {zoneNotice ? <Text style={styles.routeNotice}>{zoneNotice}</Text> : null}
              {plannedNotice ? <Text style={styles.routeNotice}>{plannedNotice}</Text> : null}
              {trailNotice ? <Text style={styles.routeNotice}>{trailNotice}</Text> : null}
              {routeNotice ? <Text style={styles.routeNotice}>{routeNotice}</Text> : null}
            </View>
          </View>
        </Modal>
      ) : (
        mapBody(false)
      )}

      {/* Below the map, never over it: the bottom corners belong to the
          provider's attribution and logo. Each caption appears only while its
          line is on the map. */}
      {surfaceMode === 'map' && !expanded ? (
        <View>
          {zoneNotice ? <Text style={styles.routeNotice}>{zoneNotice}</Text> : null}
          {plannedNotice ? <Text style={styles.routeNotice}>{plannedNotice}</Text> : null}
          {trailNotice ? <Text style={styles.routeNotice}>{trailNotice}</Text> : null}
          {routeNotice ? <Text style={styles.routeNotice}>{routeNotice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  /**
   * The card owns the gap to whatever follows it. `Screen` only pads its
   * edges — it puts no space between its children — so every card on the trip
   * screen carries its own bottom margin, and one that forgets ends up flush
   * against the next control (the same class of bug as the SOS button, P1-4).
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
  nextLine: {
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
  fullscreenNotices: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
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
    ...StyleSheet.absoluteFill,
  },
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    alignItems: 'flex-start',
    gap: 2,
    // The controls column owns the right-hand side; the panel keeps clear of
    // it so a long delivery line can never run underneath the buttons.
    maxWidth: '58%',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  panelChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chipSource: {
    // Crew surfaces hold a 14px floor (`theme/legibility.spec.ts`).
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  chipNeutral: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  panelNote: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
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
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  zoomButtonText: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[800],
    // The glyphs are centred by the box; a line height stops "+" sitting high.
    lineHeight: 24,
  },
  /** The panel's repair tap while there is no fix to draw. */
  panelCta: {
    marginTop: 4,
    minHeight: 36,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.secondary[700],
  },
  panelCtaPressed: {
    backgroundColor: colors.secondary[800],
  },
  panelCtaText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: '#ffffff',
  },
  screenReaderOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  routeNotice: {
    marginTop: spacing.xs,
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
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
