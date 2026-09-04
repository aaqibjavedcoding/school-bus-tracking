import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import { SosPanel } from '../../src/features/crew/SosPanel';
import { useCrewToday } from '../../src/features/crew';
import { crewRoleLabel } from '../../src/lib/roles';
import { EmptyState, ErrorState, LoadingView, Screen } from '../../src/components';

/**
 * Crew emergency tab (Task 44).
 *
 * Driver and conductor reach the same SOS from here — the shared
 * {@link SosPanel} component keeps the capability identical and only the
 * wording follows the role.
 *
 * The trip is resolved server-side from the caller's own roster, so the crew
 * member never has to pick one; an off-duty emergency is still recorded, just
 * without a trip attached.
 */
export default function CrewSosScreen() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useCrewToday();
  const trip = data?.trip ?? null;
  const role = user ? crewRoleLabel(user.role) : 'Crew';

  if (loading && !data) {
    return <LoadingView label="Loading your trip…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load your trip'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <Text style={styles.role}>{role} emergency</Text>
      {trip ? (
        <View style={styles.context}>
          <Text style={styles.contextText}>
            This alert will be attached to today&apos;s trip
            {data.route ? ` · ${data.route.code} ${data.route.name}` : ''}.
          </Text>
        </View>
      ) : (
        <EmptyState
          title="No trip today"
          description="You can still raise an emergency — it will be recorded without a trip."
        />
      )}

      <SosPanel tripId={trip?.id ?? null} roleLabel={role.toLowerCase()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  role: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  context: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  contextText: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
});
