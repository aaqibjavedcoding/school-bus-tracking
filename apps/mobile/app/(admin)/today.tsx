import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  TripStatus,
  type BusListResponse,
  type BusResponse,
  type RouteListResponse,
  type RouteResponse,
  type TripListResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { utcDateOnly, formatDate, formatTime } from '../../src/lib/format';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SectionTitle,
  TripStatusBadge,
} from '../../src/components';

/**
 * School-admin operations board for today: every trip of the tenant with its
 * live lifecycle state, one tap from the full trip cockpit (status actions,
 * manifest, live map, ETA, arrivals).
 */
export default function AdminTodayScreen() {
  const router = useRouter();

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    trips: TripResponse[];
    routes: RouteResponse[];
    buses: BusResponse[];
  }> => {
    const [tripsEnvelope, routesEnvelope, busesEnvelope] = await Promise.all([
      apiClient.listTrips({ page: 1, limit: 50, date: utcDateOnly() }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listBuses({ page: 1, limit: 100 }),
    ]);
    return {
      trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items,
      routes: unwrapEnvelope<RouteListResponse>(routesEnvelope).items,
      buses: unwrapEnvelope<BusListResponse>(busesEnvelope).items,
    };
  }, []);

  const summary = useMemo(() => {
    const counts = new Map<TripStatus, number>();
    for (const trip of data?.trips ?? []) {
      counts.set(trip.status, (counts.get(trip.status) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  if (loading && !data) {
    return <LoadingView label="Loading today's operations…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load trips'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const routeLabel = (trip: TripResponse): string => {
    const route = data.routes.find((entry) => entry.id === trip.route_id);
    return route ? `${route.code} · ${route.name}` : trip.route_id;
  };
  const busLabel = (trip: TripResponse): string => {
    if (!trip.bus_id) return '—';
    const bus = data.buses.find((entry) => entry.id === trip.bus_id);
    return bus ? bus.registration_number : trip.bus_id;
  };

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SectionTitle>Today · {formatDate(new Date())}</SectionTitle>

      <View style={styles.summaryRow}>
        {(
          [
            TripStatus.BOARDING,
            TripStatus.IN_PROGRESS,
            TripStatus.COMPLETED,
            TripStatus.CANCELLED,
          ] as TripStatus[]
        ).map((status) => (
          <View key={status} style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{summary.get(status) ?? 0}</Text>
            <Text style={styles.summaryLabel}>
              {status === TripStatus.IN_PROGRESS
                ? 'Driving'
                : status.charAt(0) + status.slice(1).toLowerCase()}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.summaryMeta}>
        <Badge label={`${data.trips.length} trips scheduled`} />
        <Badge label={`${data.routes.length} routes`} tone="info" />
        <Badge label={`${data.buses.length} buses`} tone="neutral" />
      </View>

      {data.trips.length === 0 ? (
        <EmptyState
          title="No trips today"
          description="Dispatch a trip from an active assignment on the Operations tab."
        />
      ) : (
        data.trips.map((trip) => (
          <Pressable
            key={trip.id}
            onPress={() => router.push(`/trips/${trip.id}`)}
            style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
          >
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {routeLabel(trip)}
                </Text>
                <Text style={styles.cardMeta}>
                  {formatTime(trip.scheduled_start_at)} · Bus {busLabel(trip)}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
            <View style={styles.badgeRow}>
              <TripStatusBadge status={trip.status} />
              {trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS ? (
                <Badge label="● Live" tone="success" />
              ) : null}
            </View>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  summaryCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  summaryValue: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: '800',
    color: colors.neutral[900],
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.neutral[500],
    fontWeight: '600',
  },
  summaryMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  cardMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: colors.neutral[300],
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
});
