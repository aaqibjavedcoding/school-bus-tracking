import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  type RouteStopsListResponse,
  type StopResponse,
  type TripListResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { formatTime, tripStatusLabel, utcDateOnly } from '../../src/lib/format';
import { useLoad } from '../../src/hooks/useLoad';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
import { EtaSummaryCard, StopsEtaList } from '../../src/features/tracking/EtaViews';
import { BusMap } from '../../src/features/map/BusMap';
import {
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  Select,
  SectionTitle,
  TrackingStateBadge,
} from '../../src/components';

/**
 * School-admin live tracking — mobile view of the web Live tracking page.
 * Pick any of today's trips and follow the bus on the map with the same
 * server-computed ETA/stop progress the web console shows.
 */
export default function AdminTrackingScreen() {
  const [selectedId, setSelectedId] = useState('');

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    trips: TripResponse[];
  }> => {
    const tripsEnvelope = await apiClient.listTrips({ page: 1, limit: 50, date: utcDateOnly() });
    return { trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items };
  }, []);

  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    return data?.trips[0]?.id ?? '';
  }, [selectedId, data]);

  const stopsLoad = useLoad(async (): Promise<StopResponse[]> => {
    const trip = data?.trips.find((entry) => entry.id === activeId);
    if (!trip) return [];
    return unwrapEnvelope<RouteStopsListResponse>(
      await apiClient.listRouteStops(trip.route_id),
    ).items;
  }, [activeId, data]);

  const live = useLiveTripTracking(activeId || null);

  if (loading && !data) {
    return <LoadingView label="Loading trips…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load trips'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  if (data.trips.length === 0) {
    return (
      <Screen refresh={() => void reload()} refreshing={loading}>
        <EmptyState
          title="No trips to track"
          description="When a trip is scheduled for today it will appear here to follow live."
        />
      </Screen>
    );
  }

  const options = data.trips.map((trip) => ({
    value: trip.id,
    label: `${trip.route_code ?? 'Route'} · ${formatTime(trip.scheduled_start_at)} · ${tripStatusLabel(trip.status)}`,
  }));

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <Select
        label="Trip"
        value={activeId}
        onChange={setSelectedId}
        options={options}
        placeholder="Select a trip"
      />

      <View style={styles.badgeRow}>
        <TrackingStateBadge state={live.trackingState} />
        <ConnectionIndicator connection={live.connection} />
      </View>

      <BusMap stops={stopsLoad.data ?? []} fix={live.fix} height={280} />

      <View style={styles.etaWrap}>
        <EtaSummaryCard eta={live.eta} fix={live.fix} />
      </View>

      <SectionTitle>Route stops</SectionTitle>
      <StopsEtaList eta={live.eta} />

      <Text style={styles.hint}>
        Tracking is live while a trip is boarding or in progress. The last known position stays
        visible after the run closes.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  etaWrap: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  hint: {
    color: colors.neutral[400],
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
