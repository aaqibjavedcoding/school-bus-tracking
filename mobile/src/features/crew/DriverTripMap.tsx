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
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import '../../lib/runtime-env.ts';
import { getRuntime } from '../../lib/runtime-environment.ts';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BusMarker } from '../map/BusMarker';
import { StopMarker } from '../map/StopMarker';
import { accuracyCirclePolygon } from '../map/accuracy-circle';
import type { BusMotionFix } from '../map/bus-motion.ts';
import { resolveMapStyleUrl } from '../map/map-style';
import { mapSurfaceMode } from '../map/map-surface-mode';
import { NeedsDevBuildPanel } from '../map/needs-dev-build-panel';
import type { RenderedMarker } from '../map/useBusMarkerMotion';
import { useFollowCamera } from '../map/useFollowCamera';
import { driverMapCopy, type DriverMapPresentation } from './crew-map-presentation.ts';

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
 * ### The engine, and what it must never become
 *
 * Same engine and style policy as the observer map (`map-style.ts`,
 * `docs/live-tracking-map.md` → "Map provider policy"): OpenFreeMap over
 * OpenStreetMap by default, an https-only self-hosted override later, no key
 * and no billing. With no network the tiles simply do not load; the marker,
 * the stops and the device position line are overlays and keep working.
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
  height?: number;
}

/**
 * The style URL for this bundle (one per build — see `map-style.ts` and the
 * note on the observer map).
 */
const MAP_STYLE_URL = resolveMapStyleUrl({
  EXPO_PUBLIC_MAP_STYLE_URL: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
});

/** Padding that keeps markers off the edge when the route is fitted. */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
/** Zoom used when there is exactly one point to frame. */
const SINGLE_POINT_ZOOM = 15;

/**
 * School-bus amber with an explicit alpha — `rgba()` rather than an 8-digit
 * hex because it is parsed identically by style-spec paint properties on both
 * platforms. Identical to the observer map's circle so a coarse fix looks the
 * same on both.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

/**
 * Only ever used for the `Camera`'s `initialViewState` — read once at map
 * creation, never as a controlled camera (see the observer map's note).
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

interface SurfaceProps {
  stops: Array<StopResponse & { latitude: number; longitude: number }>;
  routeLineFeature: Feature<LineString> | null;
  accuracyCircleFeature: Feature<Polygon> | null;
  initialCamera: InitialViewState | null;
  localFix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  animate: boolean;
  busTitle: string;
  busDescription: string;
  /**
   * Declared so the memo compares it — busting the cache on a language switch
   * so the callouts re-translate — but deliberately NOT destructured.
   */
  locale: string;
  onFrame: (marker: RenderedMarker) => void;
  onRegionChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onRegionChangeComplete: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onMapReady: () => void;
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
    accuracyCircleFeature,
    initialCamera,
    localFix,
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
      // OSM-derived tiles legally require the attribution and the logo;
      // MapLibre renders both in the BOTTOM corners, so the panel lives
      // top-left.
      attribution
      logo
      onRegionIsChanging={onRegionChange}
      onRegionDidChange={onRegionChangeComplete}
      onDidFinishLoadingMap={onMapReady}
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
              'line-color': colors.primary[600],
              'line-width': 3,
              'line-dasharray': [4, 4],
            }}
          />
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

      {stops.map((stop) => (
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

      {/* Rendered after the stops so the bus draws above them (tree order is
          the annotation z-order). */}
      {localFix ? (
        <BusMarker
          fix={localFix}
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
DriverMapSurface.displayName = 'DriverMapSurface';

export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  tripId = null,
  height = 220,
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
  const accuracyCircleFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!localFix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: localFix.latitude, longitude: localFix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [localFix, presentation.accuracyCircleMeters]);

  const {
    cameraRef,
    exploring,
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

  // Only changes when the fix changes: a per-tick callout would re-render the
  // native surface every 5 s for a string nobody can see until they tap it.
  const busDescription = !localFix
    ? ''
    : `${formatSpeedKmh(localFix.speed)} · ${formatTime(localFix.recorded_at)}`;

  // Both lines, resolved together: the position line always, the delivery line
  // only when the school cannot see what is drawn (see `crew-map-presentation`).
  const copy = driverMapCopy(presentation, localFix ? formatRelative(localFix.recorded_at) : '');

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
          // The driver's GPS still works in Expo Go — only the map engine is
          // missing, so the panel names that instead of showing a blank box.
          <NeedsDevBuildPanel />
        ) : (
          <DriverMapSurface
            stops={locatedStops}
            routeLineFeature={routeLineFeature}
            accuracyCircleFeature={accuracyCircleFeature}
            initialCamera={initialCamera}
            localFix={localFix}
            tripId={tripId}
            reducedMotion={reducedMotion}
            animate={presentation.animate}
            busTitle={t('map.busA11y')}
            busDescription={busDescription}
            locale={locale}
            onFrame={onFrame}
            onRegionChange={onRegionChange}
            onRegionChangeComplete={onRegionChangeComplete}
            onMapReady={onMapReady}
            cameraRef={cameraRef}
          />
        )}

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
        </View>

        {surfaceMode === 'map' && exploring ? (
          <Pressable
            onPress={recenter}
            accessibilityRole="button"
            accessibilityLabel={t('map.followBus')}
            hitSlop={6}
            style={({ pressed }) => [styles.followButton, pressed ? styles.followPressed : null]}
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
    ...StyleSheet.absoluteFill,
  },
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    alignItems: 'flex-start',
    gap: 2,
    maxWidth: '78%',
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
  followPressed: {
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
