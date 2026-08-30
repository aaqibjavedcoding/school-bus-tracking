import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  BusListResponse,
  BusResponse,
  RouteListResponse,
  RouteResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SegmentedControl,
} from '../../src/components';

type FleetSegment = 'buses' | 'routes';

/**
 * School-admin fleet browser — the mobile view of the web Buses and Routes
 * pages side by side: every bus (registration, capacity, state) and every
 * route (code, name, state). Read-only on mobile; creating and editing
 * stays in the web console.
 */
export default function AdminFleetScreen() {
  const [segment, setSegment] = useState<FleetSegment>('buses');

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    buses: BusResponse[];
    routes: RouteResponse[];
  }> => {
    const [busesEnvelope, routesEnvelope] = await Promise.all([
      apiClient.listBuses({ page: 1, limit: 100 }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
    ]);
    return {
      buses: unwrapEnvelope<BusListResponse>(busesEnvelope).items,
      routes: unwrapEnvelope<RouteListResponse>(routesEnvelope).items,
    };
  }, []);

  if (loading && !data) {
    return <LoadingView label="Loading the fleet…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load the fleet'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const activeBuses = data.buses.filter((bus) => bus.is_active).length;
  const activeRoutes = data.routes.filter((route) => route.is_active).length;

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SegmentedControl<FleetSegment>
        value={segment}
        onChange={setSegment}
        options={[
          { value: 'buses', label: `Buses (${data.buses.length})` },
          { value: 'routes', label: `Routes (${data.routes.length})` },
        ]}
      />

      {segment === 'buses' ? (
        data.buses.length === 0 ? (
          <EmptyState
            title="No buses registered"
            description="Register buses in the web console to dispatch trips against them."
          />
        ) : (
          <>
            <Text style={styles.meta}>
              {data.buses.length} buses · {activeBuses} active
            </Text>
            {data.buses.map((bus) => (
              <View key={bus.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{bus.registration_number}</Text>
                    <Text style={styles.cardMeta}>
                      {bus.bus_number ? `${bus.bus_number} · ` : ''}
                      {bus.capacity ?? '—'} seats
                    </Text>
                  </View>
                  <Badge
                    label={bus.is_active ? 'Active' : 'Inactive'}
                    tone={bus.is_active ? 'success' : 'neutral'}
                  />
                </View>
              </View>
            ))}
          </>
        )
      ) : data.routes.length === 0 ? (
        <EmptyState
          title="No routes configured"
          description="Create routes and their stops in the web console first."
        />
      ) : (
        <>
          <Text style={styles.meta}>
            {data.routes.length} routes · {activeRoutes} active
          </Text>
          {data.routes.map((route) => (
            <View key={route.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {route.code} · {route.name}
                  </Text>
                  {route.description ? (
                    <Text style={styles.cardMeta} numberOfLines={2}>
                      {route.description}
                    </Text>
                  ) : null}
                </View>
                <Badge
                  label={route.is_active ? 'Active' : 'Inactive'}
                  tone={route.is_active ? 'success' : 'neutral'}
                />
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={styles.footnote}>
        Buses and routes are managed in the web console — this is the live fleet at a glance.
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
