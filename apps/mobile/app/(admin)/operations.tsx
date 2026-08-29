import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  RouteAssignmentRole,
  type BusListResponse,
  type BusResponse,
  type ConductorListResponse,
  type DriverListResponse,
  type RouteListResponse,
  type RouteResponse,
  type RouteAssignmentListResponse,
  type RouteAssignmentResponse,
  type StaffResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SectionTitle,
} from '../../src/components';

/**
 * School-admin operations: the mobile-critical slice of fleet management.
 *
 * - Active route assignments (driver/conductor ↔ route ↔ bus) with
 *   **dispatch now**, which creates a trip through the existing
 *   `POST /trips` (the server derives route/bus/crew from the assignment).
 * - Fleet and route overview for at-a-glance checks.
 *
 * Editing buses, routes, stops, staff and assignments stays on the web —
 * those are deliberate desktop workflows.
 */
export default function AdminOperationsScreen() {
  const router = useRouter();
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    assignments: RouteAssignmentResponse[];
    routes: RouteResponse[];
    buses: BusResponse[];
    drivers: StaffResponse[];
    conductors: StaffResponse[];
  }> => {
    const [
      assignmentsEnvelope,
      routesEnvelope,
      busesEnvelope,
      driversEnvelope,
      conductorsEnvelope,
    ] = await Promise.all([
      apiClient.listAssignments({ page: 1, limit: 100, is_active: true }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listBuses({ page: 1, limit: 100 }),
      apiClient.listDrivers({ page: 1, limit: 100 }),
      apiClient.listConductors({ page: 1, limit: 100 }),
    ]);
    return {
      assignments: unwrapEnvelope<RouteAssignmentListResponse>(assignmentsEnvelope).items,
      routes: unwrapEnvelope<RouteListResponse>(routesEnvelope).items,
      buses: unwrapEnvelope<BusListResponse>(busesEnvelope).items,
      drivers: unwrapEnvelope<DriverListResponse>(driversEnvelope).items,
      conductors: unwrapEnvelope<ConductorListResponse>(conductorsEnvelope).items,
    };
  }, []);

  const dispatch = (
    assignment: RouteAssignmentResponse,
    route?: RouteResponse,
    bus?: BusResponse | null,
  ) => {
    Alert.alert(
      'Dispatch trip now',
      `Create a trip from the active assignment${route ? ` on route ${route.code}` : ''}${bus ? ` with bus ${bus.registration_number}` : ''}? The scheduled start is set to now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dispatch',
          onPress: () => {
            void (async () => {
              setDispatchingId(assignment.id);
              setNotice(null);
              try {
                const envelope = await apiClient.createTrip({
                  route_assignment_id: assignment.id,
                  scheduled_start_at: new Date().toISOString(),
                });
                const trip = unwrapEnvelope<TripResponse>(envelope);
                router.push(`/trips/${trip.id}`);
              } catch (caught) {
                setNotice(getApiErrorMessage(caught, 'Could not dispatch the trip.'));
              } finally {
                setDispatchingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  if (loading && !data) {
    return <LoadingView label="Loading operations…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load operations'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const staffName = (assignment: RouteAssignmentResponse): string => {
    const staff =
      assignment.role === RouteAssignmentRole.DRIVER
        ? data.drivers.find((entry) => entry.id === assignment.user_id)
        : data.conductors.find((entry) => entry.id === assignment.user_id);
    return staff ? `${staff.first_name} ${staff.last_name}` : assignment.user_id;
  };

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SectionTitle>Active assignments</SectionTitle>
      {notice ? <Banner tone="danger" message={notice} /> : null}
      {data.assignments.length === 0 ? (
        <EmptyState
          title="No active assignments"
          description="Create driver/conductor assignments in the web console to dispatch trips from here."
        />
      ) : (
        data.assignments.map((assignment) => {
          const route = data.routes.find((entry) => entry.id === assignment.route_id);
          const bus = assignment.bus_id
            ? data.buses.find((entry) => entry.id === assignment.bus_id)
            : undefined;
          return (
            <Card
              key={assignment.id}
              title={route ? `${route.code} · ${route.name}` : assignment.route_id}
              description={`${staffName(assignment)} · ${bus ? bus.registration_number : 'no bus'} · since ${assignment.effective_from.slice(0, 10)}`}
            >
              <View style={styles.assignmentRow}>
                <Badge
                  label={assignment.role === RouteAssignmentRole.DRIVER ? 'Driver' : 'Conductor'}
                  tone={assignment.role === RouteAssignmentRole.DRIVER ? 'warning' : 'info'}
                />
                <Button
                  label="Dispatch now"
                  small
                  onPress={() => dispatch(assignment, route, bus ?? null)}
                  busy={dispatchingId === assignment.id}
                  disabled={dispatchingId !== null}
                />
              </View>
            </Card>
          );
        })
      )}

      <SectionTitle>Fleet</SectionTitle>
      {data.buses.length === 0 ? (
        <Text style={styles.muted}>No buses registered.</Text>
      ) : (
        <View style={styles.gridCard}>
          {data.buses.map((bus) => (
            <View key={bus.id} style={styles.gridRow}>
              <Text style={styles.gridMain}>{bus.registration_number}</Text>
              <Text style={styles.gridMeta}>
                {bus.bus_number ? `${bus.bus_number} · ` : ''}
                {bus.is_active ? 'active' : 'inactive'} · {bus.capacity ?? '—'} seats
              </Text>
            </View>
          ))}
        </View>
      )}

      <SectionTitle>Routes</SectionTitle>
      {data.routes.length === 0 ? (
        <Text style={styles.muted}>No routes configured.</Text>
      ) : (
        <View style={styles.gridCard}>
          {data.routes.map((route) => (
            <View key={route.id} style={styles.gridRow}>
              <Text style={styles.gridMain}>
                {route.code} · {route.name}
              </Text>
              <Text style={styles.gridMeta}>{route.is_active ? 'active' : 'inactive'}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.footnote}>
        Full management of students, buses, routes, stops, staff and assignments is available in the
        web console.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  gridCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  gridRow: {
    gap: 2,
  },
  gridMain: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  gridMeta: {
    fontSize: 12,
    color: colors.neutral[500],
  },
  muted: {
    color: colors.neutral[500],
    fontSize: 14,
  },
  footnote: {
    color: colors.neutral[400],
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
