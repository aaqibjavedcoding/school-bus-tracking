import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import { driverMapCopy } from './crew-map-presentation.ts';
import type { DriverTripMapProps } from './DriverTripMap';

/**
 * Web fallback for the native `DriverTripMap`.
 *
 * `react-native-maps` is a native-only module and cannot be bundled for the web
 * preview, so this renders the same *facts* without a map: this device's own
 * position, its freshness, and the ordered stops. It deliberately says the same
 * things the native panel does — including that the position is the device's
 * own and whether it has been delivered — because a web build that quietly
 * dropped the honesty line would be worse than no map at all.
 *
 * The driver screen is a mobile surface; this exists so `npm run web` and the
 * web bundle keep working, not as a supported way to drive a bus.
 */
export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  height = 220,
}) => {
  useTranslation();
  const locatedStops = useMemo(
    () => stops.filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [stops],
  );

  const copy = driverMapCopy(presentation, localFix ? formatRelative(localFix.recorded_at) : '');

  return (
    <View style={[styles.wrap, { minHeight: height }]}>
      <View style={styles.header}>
        <Ionicons name="map" size={18} color={colors.primary[600]} />
        <Text style={styles.headerText}>{t('driverMap.source')}</Text>
      </View>

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
        locatedStops.map((stop) => (
          <View key={stop.id} style={styles.stopRow}>
            <View style={styles.seq}>
              <Text style={styles.seqText}>{stop.sequence_number}</Text>
            </View>
            <View style={styles.stopBody}>
              <Text style={styles.stopName}>{stop.name}</Text>
              <Text style={styles.coords}>
                {(stop.latitude as number).toFixed(5)}, {(stop.longitude as number).toFixed(5)}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  note: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
  },
  busRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  busText: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[800],
  },
  muted: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  seq: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  stopBody: {
    flex: 1,
  },
  stopName: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[800],
  },
  coords: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[500],
  },
});
