import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, type LatLng, type Region } from 'react-native-maps';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { fixAgeMs } from '../../lib/geo';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { ConnectionState, LiveFix } from '../tracking/useLiveTripTracking';
import { BusMarker } from './BusMarker';
import type { RenderedMarker } from './useBusMarkerMotion';
import { useNow } from './useNow';
import { deriveTrackingPresentation, type TrackingPresentation } from './tracking-presentation';
import { useFollowCamera } from './useFollowCamera';

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
 * ### What this rewrite changes
 *
 * This component used to pass a **controlled** `region` recomputed from
 * `[stops, fix]`, which re-fitted the whole route on every GPS update — nobody
 * could look at a stop for longer than four seconds. The camera is now
 * uncontrolled and owned by an explicit follow policy: fit the route once per
 * trip, then only *pan* (never zoom) while following, and any genuine user
 * gesture hands the camera to the user until they press "Follow bus".
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

/** Padding that keeps markers off the edge when the route is fitted. */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
/** Zoom used when there is exactly one point to frame. */
const SINGLE_POINT_ZOOM = 15;

/**
 * School-bus amber with an explicit alpha.
 *
 * `rgba()` rather than an 8-digit hex on purpose: Android's `Color.parseColor`
 * reads `#AARRGGBB`, not `#RRGGBBAA`, so appending alpha to a 6-digit hex token
 * produces a different colour on Android than on iOS. These props are typed
 * `ColorValue` (`NativeComponentCircle.ts`) and go through `processColor`,
 * which handles `rgba()` identically on both platforms.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

/**
 * Only ever used for `initialRegion`, so the map opens somewhere sensible before
 * the first `fitToCoordinates` lands. It is deliberately **not** passed as the
 * controlled `region` prop — that prop is the bug this rewrite removes.
 */
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

// ── The map surface ────────────────────────────────────────────────────────

interface MapSurfaceProps {
  stops: Array<StopResponse & { latitude: number; longitude: number }>;
  routeCoordinates: LatLng[];
  initialRegion: Region | null;
  fix: LiveFix | null;
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
 * Memoised on purpose: the status panel re-renders every 5 s so its labels can
 * age, and none of that may reach the native map. Every prop below is either
 * stable per trip or changes only when the data genuinely changes.
 */
const MapSurface: React.FC<MapSurfaceProps> = React.memo(
  ({
    stops,
    routeCoordinates,
    initialRegion,
    fix,
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
      showsCompass={false}
      toolbarEnabled={false}
      onMapReady={onMapReady}
      onPanDrag={onUserGesture}
      onRegionChange={handleRegionChangeProxy(onRegionChange)}
      onRegionChangeComplete={handleRegionChangeProxy(onRegionChangeComplete)}
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
        // Stops keep the platform's teardrop pin in slate: visually a different
        // species from the flat, amber, rotating bus — at a glance and in a
        // screenshot.
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

      {/*
        Uncertainty drawn rather than asserted: when the device reports a coarse
        radius, the map shows the circle that radius describes instead of
        implying the bus is precisely where the dot is. Centred on the reported
        fix rather than on the interpolated marker, because the radius belongs
        to the measurement.
      */}
      {fix && accuracyCircleMeters !== null ? (
        <Circle
          center={{ latitude: fix.latitude, longitude: fix.longitude }}
          radius={accuracyCircleMeters}
          strokeColor={ACCURACY_STROKE}
          fillColor={ACCURACY_FILL}
          strokeWidth={1}
        />
      ) : null}

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

/**
 * Adapts `react-native-maps`' `(region, details)` callback to the shape the
 * follow policy wants, tolerating a provider that omits `details`.
 */
function handleRegionChangeProxy(
  handler: (region: Region, details: { isGesture?: boolean }) => void,
): (region: Region, details: { isGesture?: boolean }) => void {
  return (region, details) => handler(region, details ?? {});
}

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
  const routeCoordinates = useMemo<LatLng[]>(
    () => locatedStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
    [locatedStops],
  );

  const presentation = useMemo(
    () =>
      deriveTrackingPresentation({
        fixAgeMs: fix ? fixAgeMs(fix.received_at, now) : null,
        accuracyMeters: fix?.accuracy ?? null,
        socketOffline: connection === 'offline',
      }),
    [fix, connection, now],
  );

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
  // animation loop and moves the camera imperatively through the map ref.
  const {
    mapRef,
    exploring,
    onFrame: handleFrame,
    onUserGesture,
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

  const initialRegion = useMemo(() => {
    const points: LatLng[] = [...routeCoordinates];
    if (fix) points.push({ latitude: fix.latitude, longitude: fix.longitude });
    return initialRegionFor(points);
    // Keyed on stops only: `initialRegion` is read once by the native map, and
    // recomputing it per fix would be a controlled camera in disguise.
  }, [routeCoordinates]);

  if (routeCoordinates.length === 0 && !fix) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>{t('map.noCoordinates')}</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.wrap, { height }]}>
        <MapSurface
          stops={locatedStops}
          routeCoordinates={routeCoordinates}
          initialRegion={initialRegion}
          fix={fix}
          tripId={tripId}
          reducedMotion={reducedMotion}
          animate={presentation.animate}
          accuracyCircleMeters={presentation.accuracyCircleMeters}
          busTitle={busTitle ?? t('map.busA11y')}
          busDescription={busDescription}
          locale={locale}
          onFrame={handleFrame}
          onUserGesture={onUserGesture}
          onRegionChange={handleRegionChange}
          onRegionChangeComplete={handleRegionChangeComplete}
          onMapReady={handleMapReady}
          mapRef={mapRef}
        />

        {/* Top-left: clear of the Google Maps attribution (bottom-left) and the
          Apple Maps legal button (bottom-right). */}
        <MapStatusPanel presentation={presentation} fix={fix} now={now} />

        {exploring ? (
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

      {routeCoordinates.length > 1 ? (
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
