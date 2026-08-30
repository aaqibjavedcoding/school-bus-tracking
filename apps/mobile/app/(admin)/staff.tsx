import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ConductorListResponse,
  DriverListResponse,
  StaffResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { fullName } from '../../src/lib/format';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SegmentedControl,
} from '../../src/components';

type StaffSegment = 'drivers' | 'conductors';

/**
 * School-admin staff directory — the mobile view of the web "Drivers &
 * conductors" page. Accounts are listed read-only (no credentials are ever
 * exposed by the API); creating and editing crew stays in the web console.
 */
export default function AdminStaffScreen() {
  const [segment, setSegment] = useState<StaffSegment>('drivers');

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    drivers: StaffResponse[];
    conductors: StaffResponse[];
  }> => {
    const [driversEnvelope, conductorsEnvelope] = await Promise.all([
      apiClient.listDrivers({ page: 1, limit: 100 }),
      apiClient.listConductors({ page: 1, limit: 100 }),
    ]);
    return {
      drivers: unwrapEnvelope<DriverListResponse>(driversEnvelope).items,
      conductors: unwrapEnvelope<ConductorListResponse>(conductorsEnvelope).items,
    };
  }, []);

  if (loading && !data) {
    return <LoadingView label="Loading staff…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load staff'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const staff = segment === 'drivers' ? data.drivers : data.conductors;
  const activeCount = staff.filter((person) => person.is_active).length;

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SegmentedControl<StaffSegment>
        value={segment}
        onChange={setSegment}
        options={[
          { value: 'drivers', label: `Drivers (${data.drivers.length})` },
          { value: 'conductors', label: `Conductors (${data.conductors.length})` },
        ]}
      />

      {staff.length === 0 ? (
        <EmptyState
          title={`No ${segment} yet`}
          description={`Create ${segment === 'drivers' ? 'driver' : 'conductor'} accounts in the web console, then assign them to routes from the Operations tab.`}
        />
      ) : (
        <>
          <Text style={styles.meta}>
            {staff.length} {segment} · {activeCount} active
          </Text>
          {staff.map((person) => (
            <View key={person.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{fullName(person)}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {person.email}
                    {person.phone ? ` · ${person.phone}` : ''}
                  </Text>
                </View>
                <Badge
                  label={person.is_active ? 'Active' : 'Inactive'}
                  tone={person.is_active ? 'success' : 'neutral'}
                />
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={styles.footnote}>
        Crew accounts are managed in the web console; assign them to routes on the Operations tab.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  cardMeta: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: 2,
  },
  footnote: {
    color: colors.neutral[400],
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
