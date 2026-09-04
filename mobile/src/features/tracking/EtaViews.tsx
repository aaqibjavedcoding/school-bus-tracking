import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TripEtaResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Badge, KeyValue, SectionTitle } from '../../components';
import {
  formatDistanceMeters,
  formatEtaMinutes,
  formatRelative,
  formatSpeedKmh,
} from '../../lib/format';
import type { LiveFix } from './useLiveTripTracking';

/**
 * Task 22 ETA/progress surfaces, rendered from server-computed data only:
 * the REST ETA snapshot plus `trip:eta:update` pushes. The client never
 * computes a distance or an ETA itself.
 */

/** Compact "where is the bus / what's next" card. */
export const EtaSummaryCard: React.FC<{
  eta: TripEtaResponse | null;
  fix: LiveFix | null;
}> = ({ eta, fix }) => {
  if (!eta) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>ETA information is unavailable right now.</Text>
      </View>
    );
  }

  const nextStop = eta.next_stop;
  const currentStop = eta.current_stop;
  const hasEta = eta.eta_available;

  return (
    <View style={styles.card}>
      {!hasEta ? (
        <Text style={styles.muted}>Waiting for the first GPS fix — no ETA yet.</Text>
      ) : nextStop ? (
        <>
          <View style={styles.row}>
            <Text style={styles.emoji}>📍</Text>
            <Text style={styles.headline} numberOfLines={2}>
              Next: {nextStop.stop_name}
            </Text>
          </View>
          <View style={styles.kvRow}>
            <KeyValue label="Distance" value={formatDistanceMeters(nextStop.distance_meters)} />
            <KeyValue label="ETA" value={formatEtaMinutes(nextStop.eta_minutes) ?? 'Unavailable'} />
            <KeyValue label="Speed" value={formatSpeedKmh(eta.speed_kmh)} />
          </View>
        </>
      ) : (
        <Text style={styles.headline}>✅ All stops on this trip have been reached.</Text>
      )}
      {currentStop ? (
        <Text style={styles.currentStop}>Current stop: {currentStop.stop_name}</Text>
      ) : null}
      {fix ? (
        <Text style={styles.muted}>Last GPS fix {formatRelative(fix.recorded_at)}</Text>
      ) : null}
    </View>
  );
};

/** Full ordered stop list with per-stop ETA and arrival state. */
export const StopsEtaList: React.FC<{ eta: TripEtaResponse | null }> = ({ eta }) => {
  if (!eta || eta.items.length === 0) {
    return <Text style={styles.muted}>No stops are configured for this route.</Text>;
  }
  return (
    <View style={styles.listWrap}>
      {eta.items.map((stop) => {
        const isNext = eta.next_stop?.stop_id === stop.stop_id;
        const isCurrent = eta.current_stop?.stop_id === stop.stop_id;
        return (
          <View key={stop.stop_id} style={[styles.stopRow, isNext ? styles.stopRowNext : null]}>
            <View style={styles.stopNumber}>
              <Text style={styles.stopNumberText}>{stop.sequence_number}</Text>
            </View>
            <View style={styles.stopMain}>
              <Text style={styles.stopName} numberOfLines={1}>
                {stop.stop_name}
              </Text>
              <Text style={styles.stopMeta}>
                {stop.arrived
                  ? 'Arrived'
                  : formatEtaMinutes(stop.eta_minutes) !== null
                    ? `${formatEtaMinutes(stop.eta_minutes)} · ${formatDistanceMeters(stop.distance_meters)}`
                    : 'Waiting for GPS'}
              </Text>
            </View>
            {stop.arrived ? (
              <Badge label="✓" tone="success" />
            ) : isNext ? (
              <Badge label="Next" tone="warning" />
            ) : isCurrent ? (
              <Badge label="Current" tone="info" />
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

export const TrackingSection: React.FC<{ title: string }> = ({ title }) => (
  <SectionTitle>{title}</SectionTitle>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emoji: {
    fontSize: 18,
  },
  headline: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.neutral[900],
    flex: 1,
  },
  currentStop: {
    fontSize: 14,
    color: colors.neutral[600],
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    color: colors.neutral[500],
  },
  kvRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  listWrap: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  stopRowNext: {
    backgroundColor: '#fffbeb',
  },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.neutral[800],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumberText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  stopMain: {
    flex: 1,
    gap: 2,
  },
  stopName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  stopMeta: {
    fontSize: 12,
    color: colors.neutral[500],
  },
});
