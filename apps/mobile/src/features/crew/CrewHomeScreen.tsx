import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { Screen } from '../../components/Screen';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState, ErrorBanner, LoadingView } from '../../components/Feedback';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { SectionTitle } from '../../components/StatCard';
import { useAuth } from '../../auth/auth-context';
import { getGlobalSession } from '../../auth/global-session';
import { useCrewToday } from './use-crew-today';
import { formatDateTime, tripStatusTone, TRIP_STATUS_LABELS } from '../../utils/format';

/**
 * Driver / Conductor home (Task 23 §D/§F): today's assigned trips with the
 * essentials up top — bus, route, scheduled time, status, student count.
 * "No trip assigned for today" is an explicit state, not an empty list.
 */
export const CrewHomeScreen: React.FC<{ mode: 'driver' | 'conductor' }> = ({ mode }) => {
  const { user, logout } = useAuth();
  const today = useCrewToday();

  const focusTrip = today.current ?? today.next ?? today.trips[0] ?? null;

  return (
    <Screen>
      <ConnectionBanner />
      <Card>
        <Text style={styles.greeting}>
          {mode === 'driver' ? 'Driver on duty' : 'Conductor on duty'}
        </Text>
        <Text style={styles.name}>{user ? `${user.first_name} ${user.last_name}` : ''}</Text>
        <View style={styles.headerRow}>
          <StatusBadge
            tone="info"
            label={formatDateTime(`${today.todayLabel}T00:00:00Z`)}
            compact
          />
          <Pressable accessibilityRole="button" onPress={() => void logout()} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </Card>

      {today.error ? (
        <ErrorBanner message={today.error} onRetry={() => void today.refresh()} />
      ) : null}

      {today.loading && today.trips.length === 0 ? (
        <LoadingView label="Checking today’s dispatch…" />
      ) : !today.loading && today.trips.length === 0 ? (
        <EmptyState
          title="No trip assigned for today"
          message="When the school dispatches you from an assignment, your trip appears here."
          icon="🗓️"
        />
      ) : (
        <>
          {focusTrip ? (
            <>
              <SectionTitle title={today.current ? 'Current trip' : 'Next trip'} />
              <TripContextCard trip={focusTrip} mode={mode} emphasized />
            </>
          ) : null}
          <SectionTitle title="All trips today" />
          {today.trips.map((trip) => (
            <TripContextCard key={trip.id} trip={trip} mode={mode} />
          ))}
        </>
      )}
    </Screen>
  );
};

const TripContextCard: React.FC<{
  trip: TripResponse;
  mode: 'driver' | 'conductor';
  emphasized?: boolean;
}> = ({ trip, mode, emphasized }) => {
  const router = useRouter();
  const api = getGlobalSession().apiClient;
  const [context, setContext] = useState<{
    routeName: string;
    busLabel: string;
    students: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [route, bus, manifest] = await Promise.all([
        trip.route_id ? api.getRoute(trip.route_id).catch(() => null) : Promise.resolve(null),
        trip.bus_id ? api.getBus(trip.bus_id).catch(() => null) : Promise.resolve(null),
        api.listTripStudents(trip.id).catch(() => null),
      ]);
      if (!cancelled) {
        setContext({
          routeName: route?.data?.name ?? 'Route',
          busLabel: bus?.data
            ? bus.data.bus_number
              ? `Bus ${bus.data.bus_number} · ${bus.data.registration_number}`
              : bus.data.registration_number
            : 'No bus assigned',
          students: manifest?.data?.summary.total ?? null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, trip.route_id, trip.bus_id, trip.id]);

  const tone = tripStatusTone(trip.status);
  const subtitle = useMemo(
    () => (context ? `${context.routeName} · ${context.busLabel}` : 'Loading bus & route…'),
    [context],
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/${mode}/trip/${trip.id}` as never)}
      style={({ pressed }) => [styles.tripCard, pressed && styles.pressed]}
    >
      <View style={styles.tripRow}>
        <View style={styles.tripText}>
          <Text style={styles.tripTitle}>{subtitle}</Text>
          <Text style={styles.tripMeta}>
            Scheduled {formatDateTime(trip.scheduled_start_at)}
            {context?.students != null ? ` · ${context.students} students` : ''}
          </Text>
        </View>
        <StatusBadge tone={tone} label={TRIP_STATUS_LABELS[trip.status]} compact />
      </View>
      {emphasized ? (
        <Button
          label={trip.status === 'COMPLETED' ? 'Open trip summary' : 'Open trip'}
          small
          style={styles.openButton}
          onPress={() => router.push(`/${mode}/trip/${trip.id}` as never)}
        />
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  greeting: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.neutral[500],
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.neutral[900],
    marginTop: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  signOut: {
    color: colors.primary[700],
    fontWeight: '700',
    fontSize: 13,
  },
  tripCard: {
    backgroundColor: '#ffffff',
    borderRadius: spacing.xs,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.neutral[100],
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tripText: {
    flex: 1,
  },
  tripTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  tripMeta: {
    fontSize: 12,
    color: colors.neutral[600],
    marginTop: 2,
  },
  openButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
});
