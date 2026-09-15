import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import { SosPanel } from '../../src/features/crew/SosPanel';
import { useCrewToday } from '../../src/features/crew';
import { crewRoleLabel } from '../../src/lib/roles';
import { EmptyState, ErrorState, LoadingView, Screen } from '../../src/components';
import { useTranslation } from '../../src/lib/i18n-provider';

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
  const t = useTranslation();
  const { data, loading, refreshing, error, reload, refresh } = useCrewToday();
  const trip = data?.trip ?? null;
  const role = user ? crewRoleLabel(user.role) : t('role.crew');

  if (loading && !data) {
    return <LoadingView label={t('sos.loading')} />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState
          legible
          message={error ?? t('manifest.loadError')}
          onRetry={() => void reload()}
        />
      </Screen>
    );
  }

  return (
    <Screen refresh={() => void refresh()} refreshing={refreshing}>
      <Text style={styles.role}>{t('sos.roleTitle', { role })}</Text>
      {trip ? (
        <View style={styles.context}>
          <Text style={styles.contextText}>
            {data.route
              ? t('sos.attachTripRoute', { route: `${data.route.code} ${data.route.name}` })
              : t('sos.attachTrip')}
          </Text>
        </View>
      ) : (
        <EmptyState
          legible
          icon="warning-outline"
          title={t('sos.empty.title')}
          description={t('sos.empty.body')}
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
    fontSize: typography.fontSizes.base,
    color: colors.neutral[700],
  },
});
