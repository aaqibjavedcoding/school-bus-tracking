import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { spacing } from '@school-bus-tracking/design-tokens';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { Screen } from '../../../src/components/Screen';
import { ListRow } from '../../../src/components/ListRow';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { RefreshList } from '../../../src/components/RefreshList';
import { ErrorBanner } from '../../../src/components/Feedback';
import { getGlobalSession } from '../../../src/auth/global-session';
import { useLoad } from '../../../src/hooks/use-load';
import { useActiveTripsForMonitoring } from '../../../src/features/admin/admin-hooks';
import { formatTime, tripStatusTone, TRIP_STATUS_LABELS } from '../../../src/utils/format';

/**
 * Live monitoring list (Task 23 §C): today's trips that are in motion, so an
 * admin can pick one to watch. Positions never appear in this list — they
 * belong to the per-trip room and stream only in the detail view.
 */
export default function AdminMonitoringListScreen() {
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const monitoring = useActiveTripsForMonitoring();

  const names = useLoad(async () => {
    const [routes, buses] = await Promise.all([
      api.listRoutes({ limit: 100 }).catch(() => null),
      api.listBuses({ limit: 100 }).catch(() => null),
    ]);
    return {
      routes: new Map((routes?.data?.items ?? []).map((r) => [r.id, r.name])),
      buses: new Map(
        (buses?.data?.items ?? []).map((b) => [
          b.id,
          b.bus_number ? `Bus ${b.bus_number}` : b.registration_number,
        ]),
      ),
    };
  }, []);

  const row = (trip: TripResponse) => ({
    id: trip.id,
    routeLabel: names.data?.routes.get(trip.route_id) ?? 'Route',
    busLabel: trip.bus_id ? (names.data?.buses.get(trip.bus_id) ?? 'Bus') : 'No bus assigned',
  });

  return (
    <Screen scroll={false}>
      {monitoring.error ? (
        <ErrorBanner message={monitoring.error} onRetry={() => void monitoring.reload()} />
      ) : null}
      <Text style={styles.hint}>
        Rows refresh on pull; positions stream continuously inside a trip.
      </Text>
      <RefreshList
        data={monitoring.data ?? []}
        loading={monitoring.loading}
        refreshing={monitoring.refreshing}
        onRefresh={() => void monitoring.refresh()}
        emptyTitle="No trips in motion"
        emptyMessage="Active means boarding, in progress, or arriving at a stop."
        skeleton
        keyExtractor={(item: TripResponse) => item.id}
        renderItem={({ item }: { item: TripResponse }) => {
          const view = row(item);
          return (
            <ListRow
              title={view.routeLabel}
              subtitle={view.busLabel}
              meta={
                item.actual_start_at
                  ? `Started ${formatTime(item.actual_start_at)}`
                  : 'Not departed yet'
              }
              right={
                <StatusBadge
                  tone={tripStatusTone(item.status)}
                  label={TRIP_STATUS_LABELS[item.status]}
                  compact
                />
              }
              onPress={() => router.push(`/admin/monitoring/${item.id}` as never)}
            />
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: spacing.md,
  },
});
