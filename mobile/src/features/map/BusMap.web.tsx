import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { formatSpeedKmh, formatTime } from '../../lib/format';
import { fixAgeMs } from '../../lib/geo';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { useNow } from './useNow';
import { deriveTrackingPresentation } from './tracking-presentation';
import type { BusMapProps } from './BusMap';
import { LiveWebViewMap, useWebgl2Supported } from './LiveWebViewMap.web';

/**
 * Web fallback for the native `BusMap` — now a REAL map.
 *
 * The native map needs the MapLibre engine, a native module that cannot be
 * bundled for the web preview, so this used to render a dependency-free
 * summary list instead: `npm run web` showed no bus, because there was no
 * map. It now renders MapLibre GL JS through `LiveWebViewMap.web.tsx` (same
 * style policy, same follow/zoom controls, same one-layer stops), and keeps
 * the summary list ONLY as the degraded state for a browser with no WebGL —
 * the one case where a map is impossible.
 */
export const BusMap: React.FC<BusMapProps> = ({
  stops,
  fix,
  height = 260,
  busTitle,
  tripId = null,
  connection = 'offline',
  nextStopId = null,
}) => {
  useTranslation();
  const now = useNow(5_000);
  const webgl = useWebgl2Supported();
  const presentation = useMemo(
    () =>
      deriveTrackingPresentation({
        fixAgeMs: fix ? fixAgeMs(fix.received_at, now) : null,
        accuracyMeters: fix?.accuracy ?? null,
        socketOffline: connection === 'offline',
      }),
    [fix, connection, now],
  );
  const locatedStops = useMemo(
    () => stops.filter((stop) => stop.latitude !== null && stop.longitude !== null),
    [stops],
  );

  if (webgl !== false) {
    return (
      <LiveWebViewMap
        variant="observer"
        stops={stops}
        fix={fix}
        tripId={tripId}
        height={height}
        nextStopId={nextStopId}
        animate={presentation.animate}
        busTitle={busTitle ?? t('map.busA11y')}
        headerTitle={busTitle ?? t('map.busA11y')}
        panel={
          <View style={styles.panel}>
            {fix ? (
              <Text style={styles.panelNote}>
                {presentation.mayReportLiveMotion
                  ? `${formatSpeedKmh(fix.speed)} · ${formatTime(fix.recorded_at)}`
                  : `${t('map.status.lastKnown')} · ${formatTime(fix.recorded_at)}`}
              </Text>
            ) : null}
            {connection === 'offline' ? (
              <Text style={styles.panelNote}>{t('map.offlineNote')}</Text>
            ) : null}
          </View>
        }
      />
    );
  }

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
            {busTitle ?? 'Bus'} · {formatSpeedKmh(fix.speed)} · {formatTime(fix.recorded_at)}
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
    fontSize: typography.fontSizes.sm,
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
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  stopName: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  coords: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  panelNote: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
});
