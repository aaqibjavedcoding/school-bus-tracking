import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import { useCrewToday, TripStatusActions, useCrewLocationSharing } from '../../src/features/crew';
import { GpsSharePanel } from '../../src/features/crew/GpsSharePanel';
import { SosPanel } from '../../src/features/crew/SosPanel';
import { TripNavigationCard } from '../../src/features/crew/TripNavigationCard';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { EtaSummaryCard } from '../../src/features/tracking/EtaViews';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
import { UserRole, type StopResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  Screen,
  SectionTitle,
  TripStatusBadge,
} from '../../src/components';
import { formatDate, formatTime, roleLabel } from '../../src/lib/format';
import { crewRoleLabel } from '../../src/lib/roles';

/**
 * Crew "today" screen (DRIVER + CONDUCTOR): the day's run, its lifecycle
 * (BOARDING → IN_PROGRESS → COMPLETED), native GPS sharing, and the live
 * current/next stop with the server-computed ETA.
 *
 * Task 44 splits the emphasis by role without duplicating any plumbing: the
 * driver leads with GPS sharing plus navigation to the next stop, the
 * conductor is pointed at boarding & drop. Both keep the SOS panel in reach.
 */
export default function CrewTripScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data, loading, error, reload } = useCrewToday();
  const trip = data?.trip ?? null;
  const sharing = useCrewLocationSharing(trip);
  const live = useLiveTripTracking(trip?.id ?? null);
  const isDriver = user?.role === UserRole.DRIVER;

  // The ordered stops of the trip's route, used by the driver's navigation
  // hand-off. Loading them on this screen keeps the "Navigate" card honest:
  // it points at a real stop of this run, never at a guessed coordinate.
  const stopsLoad = useLoad<StopResponse[]>(async () => {
    if (!trip) return [];
    return unwrapEnvelope(await apiClient.listRouteStops(trip.route_id)).items;
  }, [trip?.route_id]);

  if (loading && !data) {
    return <LoadingView label="Loading today's trip…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load your trips'} onRetry={() => void reload()} />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen refresh={() => void reload()} refreshing={loading}>
        <EmptyState
          title="No trip scheduled today"
          description="You have no runs assigned for today. Trips appear here as soon as the school dispatches them."
        />
      </Screen>
    );
  }

  const route = data.route;
  const bus = data.bus;

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SectionTitle>Today's trip</SectionTitle>

      <Card title={route ? `${route.code} · ${route.name}` : 'Route details'}>
        <View style={styles.badgeRow}>
          <TripStatusBadge status={trip.status} />
          {user ? <Text style={styles.roleChip}>{roleLabel(user.role)}</Text> : null}
        </View>
        <View style={styles.kvRow}>
          <KeyValue label="Scheduled" value={formatTime(trip.scheduled_start_at)} />
          <KeyValue label="Date" value={formatDate(trip.scheduled_start_at)} />
          <KeyValue
            label="Bus"
            value={
              bus
                ? `${bus.registration_number}${bus.bus_number ? ` · ${bus.bus_number}` : ''}`
                : '—'
            }
          />
        </View>
        {trip.actual_start_at ? (
          <Text style={styles.muted}>Departed {formatTime(trip.actual_start_at)}</Text>
        ) : null}
        {trip.actual_end_at ? (
          <Text style={styles.muted}>Arrived {formatTime(trip.actual_end_at)}</Text>
        ) : null}
      </Card>

      <TripStatusActions trip={trip} onApplied={() => void reload()} />

      {/**
       * Driver-only: GPS sharing is the driver's job and navigation belongs to
       * whoever is behind the wheel. The conductor's trip screen keeps the
       * same trip data but points at the manifest instead (below).
       */}
      {isDriver ? <GpsSharePanel trip={trip} sharing={sharing} /> : null}

      {isDriver ? (
        <TripNavigationCard
          trip={trip}
          stops={stopsLoad.data ?? []}
          nextStopId={live.eta?.next_stop?.stop_id ?? null}
        />
      ) : null}

      <Card title="Live progress">
        <View style={styles.badgeRow}>
          <ConnectionIndicator connection={live.connection} />
        </View>
        <EtaSummaryCard eta={live.eta} fix={live.fix} />
      </Card>

      <View style={styles.linkRow}>
        {isDriver ? (
          <Button
            label="Open manifest"
            variant="secondary"
            onPress={() => router.push('/manifest')}
            style={styles.linkButton}
          />
        ) : (
          <Button
            label="Board & drop"
            variant="secondary"
            onPress={() => router.push('/manifest')}
            style={styles.linkButton}
          />
        )}
        <Button
          label="Stops & ETA"
          variant="secondary"
          onPress={() => router.push('/stops')}
          style={styles.linkButton}
        />
      </View>

      {/* SOS is reachable from its own tab for both roles and repeated here so
          it is one tap away while the trip is on the screen. */}
      <SosPanel tripId={trip.id} roleLabel={user ? crewRoleLabel(user.role).toLowerCase() : 'crew'} />

      {data.trips.length > 1 ? (
        <Text style={styles.mutedCentered}>
          {data.trips.length} trips today · showing the active one
        </Text>
      ) : null}
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
  roleChip: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    fontWeight: '600',
  },
  kvRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  muted: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  mutedCentered: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  linkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkButton: {
    flex: 1,
    borderRadius: borderRadius.md,
  },
});
