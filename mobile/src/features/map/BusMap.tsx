import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type NativeSyntheticEvent } from 'react-native';
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
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { fixAgeMs } from '../../lib/geo';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import '../../lib/runtime-env.ts';
import { getRuntime } from '../../lib/runtime-environment.ts';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { ConnectionState, LiveFix } from '../tracking/useLiveTripTracking';
import { accuracyCirclePolygon } from './accuracy-circle';
import { BusMarker } from './BusMarker';
import { StopMarker } from './StopMarker';
import { resolveMapStyleUrl } from './map-style';
import { mapSurfaceMode } from './map-surface-mode';
import { NeedsDevBuildPanel } from './needs-dev-build-panel';
import type { RenderedMarker } from './useBusMarkerMotion';
import { useNow } from './useNow';
import { deriveTrackingPresentation, type TrackingPresentation } from './tracking-presentation';
import { useFollowCamera } from './useFollowCamera';

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
 * Native live-tracking map (parent tracking, admin trip detail, admin tracking).
 *
 * ### Where positions come from, and where they do not
 *
 * The only coordinates this map ever draws are the route's stops (from the API)
 * and GPS fixes streamed over the existing Socket.IO namespace. Between two
 * fixes the marker is *interpolated* — presentation only, so the bus glides
 * instead of teleporting every ~4 s. Interpolated coordinates stay inside the
 * marker: nothing here writes them into tracking history, ETA, attendance or
 * notifications, and the marker never travels past the newest real fix.
 *
 * **Interpolation is not road matching.** Two sparse points are joined by a
 * straight line, so on a bend the bus visibly cuts the corner. The dashed line
 * between stops is the same kind of straight line, and the map says so. See
 * `docs/live-tracking-map.md`.
 *
 * ### The engine, and what it must never become
 *
 * Tiles and vector data come from one URL, resolved by `map-style.ts`:
 * OpenFreeMap's public style over OpenStreetMap data by default, an
 * https-only override when self-hosting later. No key, no account, no billing
 * — the rule and its rationale live in `docs/live-tracking-map.md` → "Map
 * provider policy". When there is no network the tiles simply do not load;
 * the markers, the accuracy circle and the freshness panel below are
 * React Native views and overlays, so they keep working.
 *
 * ### What the camera does (and does not do)
 *
 * The camera is uncontrolled and owned by an explicit follow policy: fit the
 * route once per trip, then only *pan* (never zoom) while following, and any
 * genuine user gesture hands the camera to the user until they press "Follow
 * bus". One implementation, shared with the Driver Trip map: the policy lives
 * in `follow-camera.ts` (pure reducer) and `follow-camera-controller.ts`
 * (pure over a camera port); `useFollowCamera` is the React binding that
 * speaks to the MapLibre `Camera` ref.
 */
export interface BusMapProps {
  stops: StopResponse[];
  fix: LiveFix | null;
  height?: number;
  busTitle?: string;
  /**
   * Trip identity. Changing it drops the previous bus's rendered position and
   * refits the camera; without it a trip switch would tween the new bus in from
   * wherever the old one was.
   */
  tripId?: string | null;
  /**
   * Socket state, so the map can say "offline" independently of GPS freshness.
   * Defaults to `offline` — the conservative reading for a caller that has not
   * wired it up.
   */
  connection?: ConnectionState;
}

/**
 * The style URL for this bundle. Metro inlines `process.env.EXPO_PUBLIC_*` at
 * bundle time, so this is decided once, per build, in the one place the
 * product rule allows it (`map-style.ts`) — never hard-coded in a component.
 */
const MAP_STYLE_URL = resolveMapStyleUrl({
  EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
});

/** Padding that keeps markers off the edge when the route is fitted. */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
/** Zoom used when there is exactly one point to frame. */
const SINGLE_POINT_ZOOM = 15;

/**
 * School-bus amber with an explicit alpha.
 *
 * `rgba()` rather than an 8-digit hex on purpose: the colour goes into a
 * MapLibre style-spec paint property, and `rgba()` is parsed identically on
 * both platforms, while 8-digit hex has historical portability gaps in style
 * spec parsers.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

/**
 * Only ever used for the `Camera`'s `initialViewState`, so the map opens
 * somewhere sensible before the first `fitToData` lands. The engine reads it
 * once at map creation — this is deliberately **not** a controlled camera
 * (that prop-recomputed-per-fix pattern is the bug the follow-camera rewrite
 * removed).
 */
function initialCameraFor(
  points: Array<{ latitude: number; longitude: number }>,
): InitialViewState | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return { center: [points[0].longitude, points[0].latitude], zoom: SINGLE_POINT_ZOOM };
  }
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  // The zoom at which the world's latitude span matches the fitted span
  // (1.4×, the same padding the old region used): span = 360 / 2^zoom.
  const zoom = Math.max(2, Math.log2(360 / Math.max(0.01, (maxLat - minLat) * 1.4)));
  return {
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    zoom,
  };
}

// ── The map surface ────────────────────────────────────────────────────────

interface MapSurfaceProps {
  stops: Array<StopResponse & { latitude: number; longitude: number }>;
  routeLineFeature: Feature<LineString> | null;
  accuracyCircleFeature: Feature<Polygon> | null;
  initialCamera: InitialViewState | null;
  fix: LiveFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  animate: boolean;
  busTitle: string;
  busDescription: string;
  /**
   * Declared so the memo compares it — busting the cache on a language switch
   * so the callouts re-translate — but deliberately NOT destructured: nothing
   * in the tree reads it, `t()` reads module state.
   */
  locale: string;
  onFrame: (marker: RenderedMarker) => void;
  onRegionChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onRegionChangeComplete: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onMapReady: () => void;
  cameraRef: React.RefObject<CameraRef | null>;
}

/**
 * Memoised on purpose: the status panel re-renders every 5 s so its labels can
 * age, and none of that may reach the native map. Every prop below is either
 * stable per trip or changes only when the data genuinely changes.
 */
const MapSurface: React.FC<MapSurfaceProps> = React.memo(
  ({
    stops,
    routeLineFeature,
    accuracyCircleFeature,
    initialCamera,
    fix,
    tripId,
    reducedMotion,
    animate,
    busTitle,
    busDescription,
    onFrame,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    cameraRef,
  }) => (
    <MapView
      style={styles.map}
      mapStyle={MAP_STYLE_URL}
      // OpenStreetMap-derived tiles legally require the attribution and the
      // logo; MapLibre renders both in the BOTTOM corners, which is why this
      // map's own controls live in the TOP corners.
      attribution
      logo
      onRegionIsChanging={onRegionChange}
      onRegionDidChange={onRegionChangeComplete}
      onDidFinishLoadingMap={onMapReady}
    >
      {/*
        The camera: uncontrolled after the initial state. All movement is
        imperative through `cameraRef` (see `useFollowCamera`), so a follow
        pan re-renders nothing.
      */}
      <Camera ref={cameraRef} initialViewState={initialCamera ?? undefined} />

      {routeLineFeature ? (
        <GeoJSONSource id="sbt-route" data={routeLineFeature}>
          {/*
            Straight dashed line between stops, in sequence — the same
            "not a route" honesty the notice below the map states
            (`map.routeNotice`).
          */}
          <Layer
            type="line"
            id="sbt-route-line"
            source="sbt-route"
            paint={{
              'line-color': colors.primary[600],
              'line-width': 3,
              'line-dasharray': [4, 4],
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/*
        Uncertainty drawn rather than asserted: when the device reports a
        coarse radius, the map shows the circle that radius describes instead
        of implying the bus is precisely where the dot is. Centred on the
        reported fix rather than on the interpolated marker, because the
        radius belongs to the measurement.
      */}
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

      {stops.map((stop) => (
        // Stops keep a deliberately different species from the bus — a flat,
        // slate, un-rotating dot — so a stop and the bus are different at a
        // glance and in a screenshot.
        <StopMarker
          key={stop.id}
          id={`stop-${stop.id}`}
          latitude={stop.latitude}
          longitude={stop.longitude}
          title={stop.name}
          description={`${t('map.stopA11y', { number: stop.sequence_number })}${
            stop.address ? ` · ${stop.address}` : ''
          }`}
        />
      ))}

      {/*
        The bus: rendered AFTER the stops so it draws above them (annotation
        order in the tree is the z-order), the way `zIndex` 2 > 1 did before.
      */}
      {fix ? (
        <BusMarker
          fix={fix}
          tripId={tripId}
          reducedMotion={reducedMotion}
          animate={animate}
          title={busTitle}
          description={busDescription}
          onFrame={onFrame}
        />
      ) : null}
    </MapView>
  ),
);
MapSurface.displayName = 'MapSurface';

// ── Status panel ───────────────────────────────────────────────────────────

/**
 * GPS freshness, kept strictly separate from the socket chip the screens render
 * above the map.
 *
 * A connected socket with a four-minute-old fix reads "Live" on the connection
 * chip and "Last known" here. That pair is the honest one; a single "Live" dot
 * would claim a position the bus stopped reporting.
 */
const MapStatusPanel: React.FC<{
  presentation: TrackingPresentation;
  fix: LiveFix | null;
  now: number;
}> = React.memo(({ presentation, fix, now }) => {
  useTranslation();

  if (presentation.state === 'no-location') {
    return (
      <View style={styles.panel}>
        <Text style={styles.chipTextNeutral}>{t('map.status.noLocation')}</Text>
      </View>
    );
  }

  const live = presentation.state === 'live';
  return (
    <View style={styles.panel}>
      <Text style={live ? styles.chipTextLive : styles.chipTextStale}>
        {live ? t('map.status.live') : t('map.status.lastKnown')}
      </Text>
      {presentation.approximate ? (
        <Text style={styles.chipTextNeutral}>{t('map.status.approximate')}</Text>
      ) : null}
      {fix ? (
        <Text style={styles.panelNote}>
          {presentation.mayReportLiveMotion
            ? t('map.updatedAt', { time: formatRelative(fix.received_at, now) })
            : t('map.staleNote', { time: formatTime(fix.recorded_at) })}
        </Text>
      ) : null}
      {presentation.socketOffline ? (
        <Text style={styles.panelNote}>{t('map.offlineNote')}</Text>
      ) : null}
    </View>
  );
});
MapStatusPanel.displayName = 'MapStatusPanel';

// ── The map ────────────────────────────────────────────────────────────────

export const BusMap: React.FC<BusMapProps> = ({
  stops,
  fix,
  height = 260,
  busTitle,
  tripId = null,
  connection = 'offline',
}) => {
  const reducedMotion = useReducedMotion();
  const locale = useLocale();
  // `t()` reads module state, so subscribing is what makes a language switch
  // re-render this component.
  useTranslation();
  const now = useNow(5_000);

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

  const presentation = useMemo(
    () =>
      deriveTrackingPresentation({
        fixAgeMs: fix ? fixAgeMs(fix.received_at, now) : null,
        accuracyMeters: fix?.accuracy ?? null,
        socketOffline: connection === 'offline',
      }),
    [fix, connection, now],
  );

  // The ring belongs to the measurement, not the interpolated marker, so it
  // is keyed on the raw fix and the presentation's radius only.
  const accuracyCircleFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!fix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: fix.latitude, longitude: fix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [fix, presentation.accuracyCircleMeters]);

  // Not memoised: `t()` must re-run on a language switch, and a plain string
  // compares equal in the memo below, so this costs nothing.
  const busDescription = !fix
    ? ''
    : presentation.mayReportLiveMotion
      ? // Never describe a speed as current on data that is not current.
        `${formatSpeedKmh(fix.speed)} · ${formatTime(fix.recorded_at)}`
      : `${t('map.status.lastKnown')} · ${formatTime(fix.recorded_at)}`;

  // ── Follow camera ──────────────────────────────────────────────────────
  //
  // One implementation, shared with the Driver Trip map: the policy lives in
  // `follow-camera.ts` (pure reducer) and `follow-camera-controller.ts` (pure
  // over a camera port), and `useFollowCamera` is the React binding. Following
  // the bus still re-renders nothing — `onFrame` is called from the marker's
  // animation loop and moves the camera imperatively through the camera ref.
  const {
    cameraRef,
    exploring,
    onFrame: handleFrame,
    onRegionChange: handleRegionChange,
    onRegionChangeComplete: handleRegionChangeComplete,
    onMapReady: handleMapReady,
    recenter: handleRecenter,
  } = useFollowCamera({
    routeCoordinates,
    fix,
    tripId,
    singlePointZoom: SINGLE_POINT_ZOOM,
    edgePadding: FIT_EDGE_PADDING,
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
  // panel, or the empty-route state. Precedence and rationale live in
  // `map-surface-mode.ts` (Expo Go carries no map engine on any platform).
  const surfaceMode = mapSurfaceMode(getRuntime(), routeCoordinates.length > 0, !!fix);

  if (surfaceMode === 'no-coordinates') {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>{t('map.noCoordinates')}</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.wrap, { height }]}>
        {surfaceMode === 'needs-dev-build' ? (
          // No map engine exists in this runtime — a labelled panel says so
          // instead of the blank grey box drivers used to get.
          <NeedsDevBuildPanel />
        ) : (
          <MapSurface
            stops={locatedStops}
            routeLineFeature={routeLineFeature}
            accuracyCircleFeature={accuracyCircleFeature}
            initialCamera={initialCamera}
            fix={fix}
            tripId={tripId}
            reducedMotion={reducedMotion}
            animate={presentation.animate}
            busTitle={busTitle ?? t('map.busA11y')}
            busDescription={busDescription}
            locale={locale}
            onFrame={handleFrame}
            onRegionChange={handleRegionChange}
            onRegionChangeComplete={handleRegionChangeComplete}
            onMapReady={handleMapReady}
            cameraRef={cameraRef}
          />
        )}

        {/* Top-left: clear of the MapLibre attribution and logo (bottom
          corners). Kept on every surface: the freshness of the position is
          true even when the tiles are not. */}
        <MapStatusPanel presentation={presentation} fix={fix} now={now} />

        {surfaceMode === 'map' && exploring ? (
          <Pressable
            onPress={handleRecenter}
            accessibilityRole="button"
            accessibilityLabel={t('map.followBus')}
            hitSlop={6}
            style={({ pressed }) => [
              styles.followButton,
              pressed ? styles.followButtonPressed : null,
            ]}
          >
            <Text style={styles.followButtonText}>{t('map.followBus')}</Text>
          </Pressable>
        ) : null}

        {/* The follow state is invisible to a screen reader unless spoken. */}
        <Text accessibilityLiveRegion="polite" style={styles.screenReaderOnly}>
          {exploring ? t('map.exploringA11y') : t('map.followingA11y')}
        </Text>
      </View>

      {surfaceMode === 'map' && routeCoordinates.length > 1 ? (
        /* Below the map, never over it: the bottom corners belong to the
           provider's attribution and logo. */
        <Text style={styles.routeNotice}>{t('map.routeNotice')}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  map: {
    // RN 0.86 (Expo SDK 57) removed `StyleSheet.absoluteFillObject`; the
    // frozen `StyleSheet.absoluteFill` object is the single replacement.
    ...StyleSheet.absoluteFill,
  },
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '78%',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  chipTextLive: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.secondary[800],
  },
  chipTextStale: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: '#b45309',
  },
  chipTextNeutral: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  panelNote: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
  followButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
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
  followButtonPressed: {
    backgroundColor: colors.neutral[100],
  },
  followButtonText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
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
