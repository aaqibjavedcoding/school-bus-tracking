import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  EMERGENCY_TYPE_LABELS,
  TripStatus,
  type BusListResponse,
  type EmergencyActiveListResponse,
  type EmergencyEventResponse,
  type RouteListResponse,
  type StudentListResponse,
  type TripListResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useAuth } from '../../src/features/auth';
import { utcDateOnly, formatDate, formatRelative, formatTime } from '../../src/lib/format';
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
 * School-admin operations dashboard — the mobile view of the web Dashboard:
 * headline counts (students, buses, routes, live trips) and today's trips,
 * each one tap from the full trip cockpit.
 */
export default function AdminDashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    trips: TripResponse[];
    studentCount: number;
    busCount: number;
    routeCount: number;
    /**
     * Task 44 — open/acknowledged SOS events. Failure is swallowed on
     * purpose: the dashboard must keep working even if the emergency feed is
     * briefly unavailable, and an unreachable count is better reported as
     * `null` than as a fabricated zero.
     */
    activeEmergencies: EmergencyEventResponse[] | null;
  }> => {
    const [tripsEnvelope, studentsEnvelope, busesEnvelope, routesEnvelope, emergenciesEnvelope] =
      await Promise.all([
        apiClient.listTrips({ page: 1, limit: 50, date: utcDateOnly() }),
        apiClient.listStudents({ page: 1, limit: 1 }),
        apiClient.listBuses({ page: 1, limit: 1 }),
        apiClient.listRoutes({ page: 1, limit: 1 }),
        apiClient.listActiveEmergencies().catch(() => null),
      ]);
    return {
      trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items,
      studentCount: unwrapEnvelope<StudentListResponse>(studentsEnvelope).meta.total,
      busCount: unwrapEnvelope<BusListResponse>(busesEnvelope).meta.total,
      routeCount: unwrapEnvelope<RouteListResponse>(routesEnvelope).meta.total,
      activeEmergencies: emergenciesEnvelope
        ? unwrapEnvelope<EmergencyActiveListResponse>(emergenciesEnvelope).items
        : null,
    };
  }, []);

  const liveCount = useMemo(
    () =>
      (data?.trips ?? []).filter(
        (trip) =>
          trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS,
      ).length,
    [data],
  );

  if (loading && !data) {
    return <LoadingView label="Loading dashboard…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load the dashboard'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const routeLabel = (trip: TripResponse): string =>
    trip.route_code ? `${trip.route_code} · ${trip.route_name ?? ''}`.trim() : trip.route_name ?? 'Route';
  const busLabel = (trip: TripResponse): string =>
    trip.registration_number ?? trip.bus_number ?? 'No bus';

  /**
   * Every card is a shortcut into the existing list screen for that entity —
   * no duplicated list UI. "Live trips" opens the Trips tab pre-filtered to
   * the in-progress runs via the same `status` query the list already honours.
   */
  const stats = [
    {
      label: 'Students',
      value: data.studentCount,
      icon: 'school' as const,
      tone: colors.primary[600],
      href: '/manage/students',
      hint: 'View student list',
    },
    {
      label: 'Buses',
      value: data.busCount,
      icon: 'bus' as const,
      tone: colors.secondary[600],
      href: '/manage/buses',
      hint: 'View bus list',
    },
    {
      label: 'Routes',
      value: data.routeCount,
      icon: 'git-branch' as const,
      tone: colors.status.info,
      href: '/manage/routes',
      hint: 'View route list',
    },
    {
      label: 'Live trips',
      value: liveCount,
      icon: 'radio' as const,
      tone: colors.status.danger,
      href: '/trips?status=LIVE',
      hint: 'View live trips',
    },
  ];

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <View style={styles.hero}>
        <Text style={styles.heroGreeting}>
          {user ? `Welcome, ${user.first_name}` : 'Welcome'}
        </Text>
        <Text style={styles.heroDate}>{formatDate(new Date())}</Text>
      </View>

      <View style={styles.statGrid}>
        {stats.map((stat) => (
          <Pressable
            key={stat.label}
            onPress={() => router.push(stat.href as never)}
            accessibilityRole="button"
            accessibilityLabel={`${stat.label}: ${stat.value}. ${stat.hint}`}
            style={({ pressed }) => [styles.statCard, pressed ? styles.statCardPressed : null]}
          >
            <View style={styles.statCardTop}>
              <View style={[styles.statIcon, { backgroundColor: `${stat.tone}1a` }]}>
                <Ionicons name={stat.icon} size={18} color={stat.tone} />
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral[300]} />
            </View>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </Pressable>
        ))}
      </View>

      {/**
       * Task 44 — crew SOS. Only rendered when something is actually open or
       * being handled; a quiet school sees no alarm furniture. Tap opens the
       * emergency console, where the alert can be acknowledged or resolved.
       */}
      {data.activeEmergencies && data.activeEmergencies.length > 0 ? (
        <Pressable
          onPress={() => router.push('/emergencies')}
          accessibilityRole="button"
          accessibilityLabel={`${data.activeEmergencies.length} active emergencies. Open the emergency console.`}
          style={({ pressed }) => [styles.alertCard, pressed ? styles.cardPressed : null]}
        >
          <View style={styles.alertTop}>
            <Ionicons name="warning" size={20} color={colors.status.danger} />
            <Text style={styles.alertTitle}>
              {data.activeEmergencies.length} active emergency
              {data.activeEmergencies.length === 1 ? '' : 'ies'}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.neutral[300]} />
          </View>
          {data.activeEmergencies.slice(0, 3).map((event) => (
            <Text key={event.id} style={styles.alertMeta} numberOfLines={1}>
              {EMERGENCY_TYPE_LABELS[event.type]} · {event.raised_by_name ?? 'Crew'} ·{' '}
              {formatRelative(event.triggered_at)}
            </Text>
          ))}
        </Pressable>
      ) : null}

      <View style={styles.sectionHeader}>
        <SectionTitle>Today&apos;s trips</SectionTitle>
        <Pressable onPress={() => router.push('/trips')} hitSlop={8}>
          <Text style={styles.link}>View all</Text>
        </Pressable>
      </View>

      {data.trips.length === 0 ? (
        <EmptyState
          title="No trips today"
          description="Dispatch a trip from an assignment on the Manage tab."
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
                {trip.driver_name ? (
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    Driver {trip.driver_name}
                    {trip.conductor_name ? ` · Conductor ${trip.conductor_name}` : ''}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.neutral[300]} />
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
  hero: {
    marginBottom: spacing.md,
  },
  alertCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  alertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  alertTitle: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '800',
    color: '#991b1b',
  },
  alertMeta: {
    fontSize: typography.fontSizes.sm,
    color: '#b91c1c',
    marginTop: 2,
  },
  heroGreeting: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  heroDate: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: 2,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    minHeight: 112,
    flexBasis: '47.5%',
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 6,
  },
  statCardPressed: {
    opacity: 0.7,
  },
  statCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: typography.fontSizes['2xl'],
    fontWeight: '800',
    color: colors.neutral[900],
  },
  statLabel: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: {
    color: colors.primary[700],
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
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
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
});
