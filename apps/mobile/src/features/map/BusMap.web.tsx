import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { formatSpeedKmh, formatTime } from '../../lib/format';
import type { BusMapProps } from './BusMap';

/**
 * Web fallback for the native `react-native-maps` `BusMap`.
 *
 * `react-native-maps` is a native-only module and cannot be bundled for the
 * web preview, so on web we render an equivalent, dependency-free summary:
 * the live bus position (speed + last fix time) and the ordered route stops.
 * The native map is unchanged on iOS/Android via `BusMap.tsx`.
 */
export const BusMap: React.FC<BusMapProps> = ({ stops, fix, height = 260, busTitle = 'Bus' }) => {
  const locatedStops = useMemo(
    () => stops.filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [stops],
  );

  return (
    <View style={[styles.wrap, { minHeight: height }]}>
      <View style={styles.header}>
        <Ionicons name="map" size={18} color={colors.primary[600]} />
        <Text style={styles.headerText}>Live map (open on the mobile app for the full map)</Text>
      </View>

      {fix ? (
        <View style={styles.busRow}>
          <Ionicons name="bus" size={18} color={colors.primary[600]} />
          <Text style={styles.busText}>
            {busTitle} · {formatSpeedKmh(fix.speed)} · {formatTime(fix.recorded_at)}
          </Text>
          <Text style={styles.coords}>
            {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}
          </Text>
        </View>
      ) : (
        <Text style={styles.muted}>No live GPS fix yet.</Text>
      )}

      {locatedStops.length === 0 ? (
        <Text style={styles.muted}>No stop coordinates to plot.</Text>
      ) : (
        locatedStops.map((stop) => (
          <View key={stop.id} style={styles.stopRow}>
            <View style={styles.seq}>
              <Text style={styles.seqText}>{stop.sequence_number}</Text>
            </View>
            <View style={{ flex: 1 }}>
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
    backgroundColor: '#ffffff',
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerText: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.xs,
    fontWeight: '600',
  },
  busRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    flexWrap: 'wrap',
  },
  busText: {
    color: colors.primary[800],
    fontWeight: '700',
    fontSize: typography.fontSizes.sm,
  },
  muted: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  seq: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqText: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  stopName: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  coords: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
  },
});
