import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { formatDate, formatTime, tripStatusLabel, utcDateOnly } from '../../src/lib/format';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  TripStatusBadge,
} from '../../src/components';

/**
 * School-admin trip schedule browser — the mobile view of the web Trips
 * page: every trip, any day. A day stepper walks the schedule backwards and
 * forwards (UTC calendar days, the unit the API's `date` filter uses) and
 * status chips narrow the list; tapping a trip opens the full cockpit.
 */

type StatusFilter = TripStatus | 'ALL';

const STATUS_FILTERS: StatusFilter[] = [
  'ALL',
  TripStatus.SCHEDULED,
  TripStatus.BOARDING,
  TripStatus.IN_PROGRESS,
  TripStatus.COMPLETED,
  TripStatus.CANCELLED,
];

/** `YYYY-MM-DD` shifted by whole UTC days — the trips `date` filter unit. */
function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Localised label of a UTC calendar day (anchored at UTC noon). */
function dayLabel(day: string): string {
  return formatDate(new Date(`${day}T12:00:00.000Z`));
}

export default function AdminScheduleScreen() {
  const router = useRouter();
  const today = utcDateOnly();
  const [day, setDay] = useState(today);
  const [status, setStatus] = useState<StatusFilter>('ALL');

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    trips: TripResponse[];
    routes: RouteResponse[];
    buses: BusResponse[];
  }> => {
    const [tripsEnvelope, routesEnvelope, busesEnvelope] = await Promise.all([
      apiClient.listTrips({
        page: 1,
        limit: 50,
        date: day,
        status: status === 'ALL' ? undefined : status,
      }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listBuses({ page: 1, limit: 100 }),
    ]);
    return {
      trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items,
      routes: unwrapEnvelope<RouteListResponse>(routesEnvelope).items,
      buses: unwrapEnvelope<BusListResponse>(busesEnvelope).items,
    };
  }, [day, status]);

  const isToday = day === today;

  const summary = useMemo(() => {
    const byStatus = new Map<TripStatus, number>();
    for (const trip of data?.trips ?? []) {
      byStatus.set(trip.status, (byStatus.get(trip.status) ?? 0) + 1);
    }
    return byStatus;
  }, [data]);

  if (loading && !data) {
    return <LoadingView label="Loading the schedule…" />;
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
      <View style={styles.dayRow}>
        <Pressable
          onPress={() => setDay((current) => shiftDay(current, -1))}
          style={styles.dayButton}
          accessibilityLabel="Previous day"
        >
          <Text style={styles.dayButtonText}>‹</Text>
        </Pressable>
        <View style={styles.dayLabel}>
          <Text style={styles.dayLabelText}>{dayLabel(day)}</Text>
          {isToday ? <Badge label="Today" tone="info" /> : null}
        </View>
        <Pressable
          onPress={() => setDay((current) => shiftDay(current, 1))}
          style={styles.dayButton}
          accessibilityLabel="Next day"
        >
          <Text style={styles.dayButtonText}>›</Text>
        </Pressable>
      </View>

      {!isToday ? (
        <Pressable onPress={() => setDay(today)} style={styles.backToToday}>
          <Text style={styles.backToTodayText}>Back to today</Text>
        </Pressable>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {STATUS_FILTERS.map((filter) => {
          const active = filter === status;
          const count =
            filter === 'ALL' ? data.trips.length : (summary.get(filter as TripStatus) ?? 0);
          return (
            <Pressable
              key={filter}
              onPress={() => setStatus(filter)}
              style={[styles.chip, active ? styles.chipActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {filter === 'ALL' ? 'All' : tripStatusLabel(filter as TripStatus)} · {count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {data.trips.length === 0 ? (
        <EmptyState
          title="No trips for this day"
          description={
            status === 'ALL'
              ? 'Nothing is scheduled. Dispatch a trip from an active assignment on the Operations tab.'
              : `No ${tripStatusLabel(status as TripStatus).toLowerCase()} trips on this day.`
          }
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
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  dayButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[50],
  },
  dayButtonText: {
    fontSize: 26,
    color: colors.primary[700],
    fontWeight: '700',
    marginTop: -4,
  },
  dayLabel: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  dayLabelText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  backToToday: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  backToTodayText: {
    color: colors.primary[700],
    fontSize: 13,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  chipActive: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  chipTextActive: {
    color: '#ffffff',
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
