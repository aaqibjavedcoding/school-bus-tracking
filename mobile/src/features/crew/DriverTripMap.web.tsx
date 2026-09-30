import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Feature, LineString, Polygon } from 'geojson';
import type { TripLocationHistoryResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
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
import { accuracyCirclePolygon } from '../map/accuracy-circle';
import { decimateTrailLine } from '../map/polyline-simplify.ts';
import { LiveWebViewMap, useWebgl2Supported } from '../map/LiveWebViewMap.web';
import { driverMapCopy, driverStopMarkerKind } from './crew-map-presentation.ts';
import { buildPlannedLegsLine, buildTrailLine, historyFixesForTrip } from './trip-map-geometry.ts';
import type { DriverTripMapProps } from './DriverTripMap';

/**
 * Web fallback for the native `DriverTripMap` — now a REAL map.
 *
 * It used to render the same *facts* without a map (the next-stop driving
 * line, this device's own position, its freshness, the ordered stops with the
 * next one marked), because the MapLibre engine is a native-only module that
 * cannot be bundled for the web preview. It now renders MapLibre GL JS
 * through `LiveWebViewMap.web.tsx` — the route, the one-layer stops with the
 * next-stop highlight, the arrival-zone ring, the trail and the planned
 * legs — and keeps the summary ONLY as the degraded state for a browser with
 * no WebGL. The honesty lines stay in both branches: a web build that
 * quietly dropped them would be worse than no map at all.
 *
 * The driver screen is a mobile surface; this exists so `npm run web` and
 * the web bundle keep working, not as a supported way to drive a bus.
 */
export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  tripId = null,
  height = 220,
  nextStopId = null,
  nextStopName = null,
  nextStopDistanceMeters = null,
  nextStopEtaMinutes = null,
}) => {
  useTranslation();
  const webgl = useWebgl2Supported();
  const locatedStops = useMemo(
    () => stops.filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [stops],
  );

  // The driven path: the server's recorded fixes for THIS trip, decimated
  // before it reaches the source — the same load the native map performs
  // (re-read whenever the trip changes; the web fallback has no fullscreen
  // remount to refresh it on).
  const trailLoad = useLoad<TripLocationHistoryResponse | null>(async () => {
    if (!tripId) return null;
    return unwrapEnvelope(await apiClient.getTripLocationHistory(tripId, { limit: 200 }));
  }, [tripId]);

  const copy = driverMapCopy(presentation, localFix ? formatRelative(localFix.recorded_at) : '');

  const nextLine = nextStopName
    ? t('driverMap.nextSummary', {
        name: nextStopName,
        distance:
          nextStopDistanceMeters !== null ? formatDistanceMeters(nextStopDistanceMeters) : '—',
        eta: formatEtaMinutes(nextStopEtaMinutes) ?? '—',
      })
    : null;

  if (webgl !== false) {
    return (
      <DriverTripWebViewMap
        stops={stops}
        localFix={localFix}
        presentation={presentation}
        tripId={tripId}
        height={height}
        nextStopId={nextStopId}
        nextLine={nextLine}
        copy={copy}
        trailFixes={historyFixesForTrip(trailLoad.data ?? null, tripId)}
      />
    );
  }

  return (
    <View style={[styles.wrap, { minHeight: height }]}>
      <View style={styles.header}>
        <Ionicons name="map" size={18} color={colors.primary[600]} />
        <Text style={styles.headerText}>{t('driverMap.source')}</Text>
        {presentation.approximate ? (
          <Text style={styles.headerMuted}>{t('map.status.approximate')}</Text>
        ) : null}
      </View>

      <Text style={styles.nextLine}>{nextLine ?? t('trip.nextStopFallback')}</Text>

      <Text style={styles.note}>{copy.position}</Text>
      {copy.delivery ? <Text style={styles.note}>{copy.delivery}</Text> : null}

      {localFix ? (
        <View style={styles.busRow}>
          <Ionicons name="bus" size={18} color={colors.primary[600]} />
          <Text style={styles.busText}>
            {formatSpeedKmh(localFix.speed)} · {formatTime(localFix.recorded_at)}
          </Text>
          <Text style={styles.coords}>
            {localFix.latitude.toFixed(5)}, {localFix.longitude.toFixed(5)}
          </Text>
        </View>
      ) : null}

      {locatedStops.length === 0 ? (
        <Text style={styles.muted}>{t('map.noCoordinates')}</Text>
      ) : (
        locatedStops.map((stop) => {
          const isNext = driverStopMarkerKind(stop.id, nextStopId) === 'next';
          return (
            <View key={stop.id} style={[styles.stopRow, isNext ? styles.stopRowNext : null]}>
              <View style={[styles.seq, isNext ? styles.seqNext : null]}>
                <Text style={styles.seqText}>{stop.sequence_number}</Text>
              </View>
              <View style={styles.stopBody}>
                <Text style={styles.stopName}>
                  {isNext ? `${t('map.nextBadge')} · ` : ''}
                  {stop.name}
                </Text>
                <Text style={styles.coords}>
                  {(stop.latitude as number).toFixed(5)}, {(stop.longitude as number).toFixed(5)}
                </Text>
              </View>
            </View>
          );
        })
      )}

      {/* No line is drawn on the degraded list, so no line legend either —
          the ordered list itself is the planned order. */}
    </View>
  );
};

/** The honesty lines, resolved once by the parent and shared by both branches. */
interface DriverTripWebViewMapProps {
  stops: DriverTripMapProps['stops'];
  localFix: DriverTripMapProps['localFix'];
  presentation: DriverTripMapProps['presentation'];
  tripId: string | null;
  height: number;
  nextStopId: string | null;
  nextLine: string | null;
  copy: ReturnType<typeof driverMapCopy>;
  trailFixes: ReturnType<typeof historyFixesForTrip>;
}

const DriverTripWebViewMap: React.FC<DriverTripWebViewMapProps> = ({
  stops,
  localFix,
  presentation,
  tripId,
  height,
  nextStopId,
  nextLine,
  copy,
  trailFixes,
}) => {
  // The same geometry the native driver map draws, from the same pure
  // builders — decimated trail, planned legs, accuracy ring.
  const trailFeature = useMemo<Feature<LineString> | null>(() => {
    const line = buildTrailLine(trailFixes);
    return line ? decimateTrailLine(line) : null;
  }, [trailFixes]);
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

  return (
    <LiveWebViewMap
      variant="driver"
      stops={stops}
      fix={localFix}
      tripId={tripId}
      height={height}
      nextStopId={nextStopId}
      trailFeature={trailFeature}
      plannedFeature={plannedFeature}
      accuracyCircleFeature={accuracyCircleFeature}
      animate={presentation.animate}
      busTitle={t('map.busA11y')}
      busDescription={
        localFix ? `${formatSpeedKmh(localFix.speed)} · ${formatTime(localFix.recorded_at)}` : ''
      }
      headerTitle={nextLine ?? t('trip.nextStopFallback')}
      panel={
        <View style={styles.mapPanel}>
          <Text style={styles.mapPanelChip}>{t('driverMap.source')}</Text>
          {presentation.approximate ? (
            <Text style={styles.headerMuted}>{t('map.status.approximate')}</Text>
          ) : null}
          <Text style={styles.note}>{copy.position}</Text>
          {copy.delivery ? <Text style={styles.note}>{copy.delivery}</Text> : null}
        </View>
      }
    />
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  headerMuted: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  nextLine: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.primary[700],
  },
  note: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
  busRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  busText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  coords: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  stopRowNext: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  seq: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.neutral[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqNext: {
    backgroundColor: colors.primary[600],
  },
  seqText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: typography.fontSizes.sm,
  },
  stopBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  stopName: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  muted: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
  mapPanel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    alignItems: 'flex-start',
    gap: 2,
    maxWidth: '58%',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  mapPanelChip: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
  },
});
