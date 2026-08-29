import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import { useCrewToday } from '../../src/features/crew';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
import { EtaSummaryCard, StopsEtaList } from '../../src/features/tracking/EtaViews';
import type { TripStopArrivalListResponse } from '@school-bus-tracking/shared-types';
import {
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SectionTitle,
  TrackingStateBadge,
} from '../../src/components';
import { formatDistanceMeters, formatTime } from '../../src/lib/format';

/**
 * Route stops of the crew's today trip with the live ETA stream.
 *
 * Current/next stop, per-stop ETAs and geofence arrivals all come from the
 * existing Task 22 backend (`/trips/:id/eta` + `trip:eta:update` /
 * `trip:stop:arrived` pushes). The device's own GPS feed powers those
 * numbers server-side — nothing is estimated on the client.
 */
export default function CrewStopsScreen() {
  const {
    data: today,
    loading: todayLoading,
    error: todayError,
    reload: reloadToday,
  } = useCrewToday();
  const trip = today?.trip ?? null;

  const live = useLiveTripTracking(trip?.id ?? null);

  const arrivalsLoad = useLoad<TripStopArrivalListResponse | null>(async () => {
    if (!trip) {
      return null;
    }
    return unwrapEnvelope(await apiClient.getTripArrivals(trip.id));
  }, [trip?.id]);

  if (todayLoading && !today) {
    return <LoadingView label="Loading stops…" />;
  }
  if (todayError || !today) {
    return (
      <Screen>
        <ErrorState
          message={todayError ?? 'Could not load your trip'}
          onRetry={() => void reloadToday()}
        />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen refresh={() => void reloadToday()} refreshing={todayLoading}>
        <EmptyState
          title="No trip today"
          description="Stops and ETAs appear once a trip is dispatched."
        />
      </Screen>
    );
  }

  const arrivals = [...(arrivalsLoad.data?.items ?? [])].reverse();

  return (
    <Screen
      refresh={() => {
        void reloadToday();
        void arrivalsLoad.reload();
      }}
      refreshing={todayLoading || arrivalsLoad.loading}
    >
      <View style={styles.headerRow}>
        <ConnectionIndicator connection={live.connection} />
        <TrackingStateBadge state={live.trackingState} />
      </View>

      <SectionTitle>Current &amp; next stop</SectionTitle>
      <EtaSummaryCard eta={live.eta} fix={live.fix} />
      {live.error ? <Text style={styles.error}>{live.error}</Text> : null}

      <SectionTitle>Route stops</SectionTitle>
      <StopsEtaList eta={live.eta} />

      <SectionTitle>Arrivals</SectionTitle>
      {arrivals.length === 0 ? (
        <Text style={styles.muted}>No stop has been recorded yet for this trip.</Text>
      ) : (
        <View style={styles.arrivalsCard}>
          {arrivals.map((arrival) => (
            <View key={arrival.id} style={styles.arrivalRow}>
              <Text style={styles.arrivalName}>{arrival.stop_name}</Text>
              <Text style={styles.arrivalMeta}>
                {formatTime(arrival.arrived_at)} · {formatDistanceMeters(arrival.distance_meters)}{' '}
                from stop
              </Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  error: {
    color: colors.status.danger,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  muted: {
    color: colors.neutral[500],
    fontSize: 14,
  },
  arrivalsCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  arrivalRow: {
    gap: 2,
  },
  arrivalName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  arrivalMeta: {
    fontSize: 12,
    color: colors.neutral[500],
  },
});
