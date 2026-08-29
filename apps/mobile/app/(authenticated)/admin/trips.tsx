import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { spacing } from '@school-bus-tracking/design-tokens';
import { Screen } from '../../../src/components/Screen';
import { Button } from '../../../src/components/Button';
import { ListRow } from '../../../src/components/ListRow';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { RefreshList } from '../../../src/components/RefreshList';
import { Segmented } from '../../../src/components/GpsStatus';
import { getGlobalSession } from '../../../src/auth/global-session';
import { useLoad } from '../../../src/hooks/use-load';
import { useTrips } from '../../../src/features/admin/admin-hooks';
import { formatTime, tripStatusTone, TRIP_STATUS_LABELS } from '../../../src/utils/format';
import type { TripResponse } from '@school-bus-tracking/shared-types';

type Window = 'today' | 'upcoming';

interface TripRowView {
  id: string;
  trip: TripResponse;
  routeLabel: string;
  busLabel: string;
}

/**
 * Trip list (Task 23 §C): today’s operations or the upcoming schedule.
 * Route/bus labels are enriched from the same list endpoints; the row detail
 * screen is where lifecycle actions live.
 */
export default function AdminTripsScreen() {
  const api = getGlobalSession().apiClient;
  const [window, setWindow] = useState<Window>('today');
  const trips = useTrips(window);
  const router = useRouter();

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

  const rows: TripRowView[] = (trips.data ?? []).map((trip) => ({
    id: trip.id,
    trip,
    routeLabel: names.data?.routes.get(trip.route_id) ?? 'Route',
    busLabel: trip.bus_id ? (names.data?.buses.get(trip.bus_id) ?? 'Bus') : 'No bus assigned',
  }));

  return (
    <Screen scroll={false}>
      <View style={styles.controls}>
        <Segmented
          options={['Today', 'Upcoming']}
          selected={window === 'today' ? 0 : 1}
          onSelect={(index) => setWindow(index === 0 ? 'today' : 'upcoming')}
        />
        <Button
          label="Schedule"
          small
          onPress={() => router.push('/admin/trips/new' as never)}
          style={styles.newButton}
        />
      </View>
      <RefreshList
        data={rows}
        loading={trips.loading}
        refreshing={trips.refreshing}
        error={trips.error}
        onRefresh={() => void trips.refresh()}
        emptyTitle={window === 'today' ? 'No trips today' : 'Nothing scheduled'}
        emptyMessage="Use Schedule to dispatch a trip from an active assignment."
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.routeLabel}
            subtitle={`${item.busLabel} · starts ${formatTime(item.trip.scheduled_start_at)}`}
            meta={`${item.trip.scheduled_start_at.slice(0, 10)}${
              item.trip.actual_start_at
                ? ` · departed ${formatTime(item.trip.actual_start_at)}`
                : ''
            }`}
            right={
              <StatusBadge
                tone={tripStatusTone(item.trip.status)}
                label={TRIP_STATUS_LABELS[item.trip.status]}
                compact
              />
            }
            onPress={() => router.push(`/admin/trips/${item.trip.id}` as never)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  newButton: {
    marginLeft: 'auto',
  },
});
