import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import { useCrewToday, TripStatusActions, useCrewLocationSharing } from '../../src/features/crew';
import { GpsSharePanel } from '../../src/features/crew/GpsSharePanel';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { EtaSummaryCard } from '../../src/features/tracking/EtaViews';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
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

/**
 * Crew "today" screen (DRIVER + CONDUCTOR): the day's run, its lifecycle
 * (BOARDING → IN_PROGRESS → COMPLETED), native GPS sharing, and the live
 * current/next stop with the server-computed ETA.
 */
export default function CrewTripScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data, loading, error, reload } = useCrewToday();
  const trip = data?.trip ?? null;
  const sharing = useCrewLocationSharing(trip);
  const live = useLiveTripTracking(trip?.id ?? null);

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

      <GpsSharePanel trip={trip} sharing={sharing} />

      <Card title="Live progress">
        <View style={styles.badgeRow}>
          <ConnectionIndicator connection={live.connection} />
        </View>
        <EtaSummaryCard eta={live.eta} fix={live.fix} />
      </Card>

      <View style={styles.linkRow}>
        <Button
          label="Open manifest"
          variant="secondary"
          onPress={() => router.push('/manifest')}
          style={styles.linkButton}
        />
        <Button
          label="Stops & ETA"
          variant="secondary"
          onPress={() => router.push('/stops')}
          style={styles.linkButton}
        />
      </View>

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
