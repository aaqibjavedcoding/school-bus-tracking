import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import type { TripProgressResponse } from '@school-bus-tracking/shared-types';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { ListRow } from '../../components/ListRow';
import { formatDistanceMeters, formatEtaMinutes, formatTime } from '../../utils/format';
import type { LiveTripState } from '../../socket/use-live-trip';

/**
 * Current stop / next stop / ETA / arrivals — pure presentation of the API's
 * `TripProgressResponse` (REST) enriched with the same summary pushed over
 * the `/live-tracking` socket. The ETA and the geofence arrival are computed
 * server-side only; nothing here is inferred client-side.
 */
export const StopProgressPanel: React.FC<{
  progress: TripProgressResponse | null;
  live: LiveTripState;
}> = ({ progress, live }) => {
  const eta = progress?.eta ?? null;
  const arriving = live.lastArrival;

  return (
    <Card
      title="Stops & ETA"
      description={
        eta?.eta_available
          ? 'GPS-based approximation, recomputed by the backend as the bus moves.'
          : 'No ETA yet — the backend never invents one without a GPS fix.'
      }
      right={
        <StatusBadge
          tone={
            live.connection === 'live'
              ? 'success'
              : live.connection === 'reconnecting'
                ? 'warning'
                : 'neutral'
          }
          label={
            live.connection === 'live'
              ? 'LIVE'
              : live.connection === 'reconnecting'
                ? 'RECONNECTING'
                : 'OFFLINE'
          }
        />
      }
    >
      <View style={styles.stopPair}>
        <View style={styles.stopCard}>
          <Text style={styles.stopLabel}>CURRENT STOP</Text>
          <Text style={styles.stopName} numberOfLines={2}>
            {progress?.current_stop ? progress.current_stop.stop_name : '—'}
          </Text>
        </View>
        <View style={styles.stopCard}>
          <Text style={styles.stopLabel}>NEXT STOP</Text>
          <Text style={styles.stopName} numberOfLines={2}>
            {progress?.next_stop ? progress.next_stop.stop_name : 'All stops reached'}
          </Text>
          <Text style={styles.stopEta}>
            {formatEtaMinutes(progress?.next_stop?.eta_minutes)}
            {progress?.next_stop?.distance_meters != null
              ? ` · ${formatDistanceMeters(progress.next_stop.distance_meters)}`
              : ''}
          </Text>
        </View>
      </View>

      {eta?.speed_kmh != null ? (
        <Text style={styles.speed}>
          Effective speed {Math.round(eta.speed_kmh)} km/h (from{' '}
          {eta.speed_source === 'gps' ? 'device GPS' : 'fallback'})
        </Text>
      ) : null}

      {arriving ? (
        <View style={styles.arrivalBanner}>
          <Text style={styles.arrivalText}>
            Arrived at {arriving.stop_name} · {formatTime(arriving.arrived_at)} ·{' '}
            {formatDistanceMeters(arriving.distance_meters)} from stop
          </Text>
        </View>
      ) : null}

      {progress?.arrivals && progress.arrivals.length > 0 ? (
        <View style={styles.arrivalsWrap}>
          <Text style={styles.arrivalsTitle}>Stop arrivals (server-recorded)</Text>
          {progress.arrivals
            .slice()
            .reverse()
            .slice(0, 5)
            .map((arrival) => (
              <ListRow
                key={arrival.id}
                title={arrival.stop_name}
                meta={`${formatTime(arrival.arrived_at)} · ${formatDistanceMeters(arrival.distance_meters)} from stop`}
                right={<StatusBadge tone="success" label="ARRIVED" compact />}
              />
            ))}
        </View>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  stopPair: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  stopCard: {
    flex: 1,
    backgroundColor: colors.neutral[100],
    borderRadius: spacing.xs,
    padding: spacing.sm,
  },
  stopLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.neutral[500],
    letterSpacing: 0.5,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
    marginTop: 2,
  },
  stopEta: {
    fontSize: 12,
    color: colors.neutral[600],
    marginTop: 2,
  },
  speed: {
    fontSize: 12,
    color: colors.neutral[500],
    marginBottom: spacing.sm,
  },
  arrivalBanner: {
    backgroundColor: colors.secondary[100],
    borderRadius: spacing.xs,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  arrivalText: {
    color: colors.secondary[900],
    fontSize: 12,
    fontWeight: '700',
  },
  arrivalsWrap: {
    marginTop: spacing.xs,
  },
  arrivalsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.neutral[500],
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});
