import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { driverMapCopy, driverStopMarkerKind } from './crew-map-presentation.ts';
import type { DriverTripMapProps } from './DriverTripMap';

/**
 * Web fallback for the native `DriverTripMap`.
 *
 * The native map needs the MapLibre engine, which is a native-only module and
 * cannot be bundled for the web preview, so this renders the same *facts*
 * without a map: the next-stop driving line, this device's own position, its
 * freshness, and the ordered stops with the next one marked. It deliberately
 * says the same things the native panel does — including that the position is
 * the device's own and whether it has been delivered — because a web build
 * that quietly dropped the honesty line would be worse than no map at all.
 *
 * The driver screen is a mobile surface; this exists so `npm run web` and the
 * web bundle keep working, not as a supported way to drive a bus.
 */
export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  nextStopId = null,
  nextStopName = null,
  nextStopDistanceMeters = null,
  nextStopEtaMinutes = null,
  height = 220,
}) => {
  useTranslation();
  const locatedStops = useMemo(
    () => stops.filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [stops],
  );

  const copy = driverMapCopy(presentation, localFix ? formatRelative(localFix.recorded_at) : '');

  const nextLine = nextStopName
    ? t('driverMap.nextSummary', {
        name: nextStopName,
        distance:
          nextStopDistanceMeters !== null ? formatDistanceMeters(nextStopDistanceMeters) : '—',
        eta: formatEtaMinutes(nextStopEtaMinutes) ?? '—',
      })
    : null;

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

      {/* No line is drawn on this fallback, so no line legend either — the
          ordered list itself is the planned order. */}
    </View>
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
});
