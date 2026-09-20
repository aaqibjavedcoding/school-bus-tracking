import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, type LatLng, type Region } from 'react-native-maps';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import '../../lib/runtime-env.ts';
import { getRuntime } from '../../lib/runtime-environment.ts';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BusMarker } from '../map/BusMarker';
import type { BusMotionFix } from '../map/bus-motion.ts';
import type { RenderedMarker } from '../map/useBusMarkerMotion';
import { useFollowCamera } from '../map/useFollowCamera';
import { mapSurfaceMode } from '../map/map-surface-mode';
import { NeedsDevBuildPanel } from '../map/needs-dev-build-panel';
import { driverMapCopy, type DriverMapPresentation } from './crew-map-presentation.ts';

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

/** Padding that keeps markers off the edge when the route is fitted. */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
/** Zoom used when there is exactly one point to frame. */
const SINGLE_POINT_ZOOM = 15;

/**
 * School-bus amber with an explicit alpha — `rgba()` rather than an 8-digit hex
 * because Android's `Color.parseColor` reads `#AARRGGBB`, not `#RRGGBBAA`.
 * Identical to the observer map's circle so a coarse fix looks the same on both.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

function initialRegionFor(points: LatLng[]): Region | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return { ...points[0], latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.4),
  };
}

/**
 * Adapts `react-native-maps`' `(region, details)` callback to the shape the
 * follow policy wants, tolerating a provider that omits `details`.
 */
function regionChangeProxy(
  handler: (region: Region, details: { isGesture?: boolean }) => void,
): (region: Region, details?: { isGesture?: boolean }) => void {
  return (region, details) => handler(region, details ?? {});
}

interface SurfaceProps {
  stops: Array<StopResponse & { latitude: number; longitude: number }>;
  routeCoordinates: LatLng[];
  initialRegion: Region | null;
  localFix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  animate: boolean;
  accuracyCircleMeters: number | null;
  busTitle: string;
  busDescription: string;
  /** Busts the memo on a language switch, so the callouts re-translate. */
  locale: string;
  onFrame: (marker: RenderedMarker) => void;
  onUserGesture: () => void;
  onRegionChange: (region: Region, details: { isGesture?: boolean }) => void;
  onRegionChangeComplete: (region: Region, details: { isGesture?: boolean }) => void;
  onMapReady: () => void;
  mapRef: React.RefObject<MapView | null>;
}

/**
 * Memoised so the 5 s status tick and the surrounding screen's state cannot
 * reach the native map. Every prop is either stable per trip or changes only
 * when the fix does.
 */
const DriverMapSurface: React.FC<SurfaceProps> = React.memo(
  ({
    stops,
    routeCoordinates,
    initialRegion,
    localFix,
    tripId,
    reducedMotion,
    animate,
    accuracyCircleMeters,
    busTitle,
    busDescription,
    onFrame,
    onUserGesture,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    mapRef,
  }) => (
    <MapView
      ref={mapRef}
      style={styles.map}
      initialRegion={initialRegion ?? undefined}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      onMapReady={onMapReady}
      onPanDrag={onUserGesture}
      onRegionChange={regionChangeProxy(onRegionChange)}
      onRegionChangeComplete={regionChangeProxy(onRegionChangeComplete)}
    >
      {routeCoordinates.length > 1 ? (
        <Polyline
          coordinates={routeCoordinates}
          strokeColor={colors.primary[600]}
          strokeWidth={3}
          lineDashPattern={Platform.OS === 'ios' ? [4, 4] : undefined}
        />
      ) : null}

      {stops.map((stop) => (
        <Marker
          key={stop.id}
          coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
          title={stop.name}
          description={`${t('map.stopA11y', { number: stop.sequence_number })}${
            stop.address ? ` · ${stop.address}` : ''
          }`}
          pinColor={colors.neutral[700]}
          zIndex={1}
          tracksViewChanges={false}
        />
      ))}

      {/* Uncertainty drawn rather than asserted. Centred on the reported fix,
          not on the interpolated marker, because the radius belongs to the
          measurement. */}
      {localFix && accuracyCircleMeters !== null ? (
        <Circle
          center={{ latitude: localFix.latitude, longitude: localFix.longitude }}
          radius={accuracyCircleMeters}
          strokeColor={ACCURACY_STROKE}
          fillColor={ACCURACY_FILL}
          strokeWidth={1}
        />
      ) : null}

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
  const routeCoordinates = useMemo<LatLng[]>(
    () => locatedStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
    [locatedStops],
  );

  const {
    mapRef,
    exploring,
    onFrame,
    onUserGesture,
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

  const initialRegion = useMemo(() => {
    const points: LatLng[] = [...routeCoordinates];
    if (localFix) points.push({ latitude: localFix.latitude, longitude: localFix.longitude });
    return initialRegionFor(points);
    // Keyed on stops only: `initialRegion` is read once by the native map, and
    // recomputing it per fix would be a controlled camera in disguise.
  }, [routeCoordinates]);

  // Which surface fills the map's box: tiles, the labelled development-build
  // panel, or the empty-route state (Expo Go on Android cannot render Google
  // Maps — see `map-surface-mode.ts`).
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
          // The driver's GPS still works in Expo Go — only the map provider is
          // missing, so the panel names that instead of showing a blank box.
          <NeedsDevBuildPanel />
        ) : (
          <DriverMapSurface
            stops={locatedStops}
            routeCoordinates={routeCoordinates}
            initialRegion={initialRegion}
            localFix={localFix}
            tripId={tripId}
            reducedMotion={reducedMotion}
            animate={presentation.animate}
            accuracyCircleMeters={presentation.accuracyCircleMeters}
            busTitle={t('map.busA11y')}
            busDescription={busDescription}
            locale={locale}
            onFrame={onFrame}
            onUserGesture={onUserGesture}
            onRegionChange={onRegionChange}
            onRegionChangeComplete={onRegionChangeComplete}
            onMapReady={onMapReady}
            mapRef={mapRef}
          />
        )}

        {/* Top-left: clear of the Google Maps attribution (bottom-left) and the
            Apple Maps legal button (bottom-right). Kept on every surface — the
            device's own position line is true even when the tiles are not. */}
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
           provider's attribution and legal links. */
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
