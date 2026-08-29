import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type {
  RouteListResponse,
  RouteResponse,
  RouteStopsListResponse,
  StopResponse,
  TripResponse,
  TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../../src/lib/errors';
import { useLoad } from '../../../src/hooks/useLoad';
import { useLiveTripTracking } from '../../../src/features/tracking/useLiveTripTracking';
import { ConnectionIndicator } from '../../../src/features/tracking/ConnectionIndicator';
import { EtaSummaryCard, StopsEtaList } from '../../../src/features/tracking/EtaViews';
import { BusMap } from '../../../src/features/map/BusMap';
import { isTripOpen, ManifestList, TripStatusActions } from '../../../src/features/crew';
import {
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  Screen,
  SectionTitle,
  TrackingStateBadge,
  TripStatusBadge,
} from '../../../src/components';
import { formatDate, formatTime } from '../../../src/lib/format';

/**
 * Admin trip cockpit: lifecycle control (including cancellation with a
 * reason), the live map + ETA stream, recorded geofence arrivals and the
 * student manifest with the same board/drop endpoints the crew uses.
 */
export default function AdminTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tripId = typeof id === 'string' ? id : '';
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    trip: TripResponse;
    route: RouteResponse | null;
    stops: StopResponse[];
    manifest: TripStudentManifestResponse | null;
  }> => {
    const trip = unwrapEnvelope<TripResponse>(await apiClient.getTrip(tripId));
    const [routeEnvelope, stopsEnvelope, manifestEnvelope] = await Promise.all([
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listRouteStops(trip.route_id),
      apiClient
        .listTripStudents(trip.id)
        .then((envelope) => unwrapEnvelope<TripStudentManifestResponse>(envelope))
        .catch(() => null),
    ]);
    return {
      trip,
      route:
        unwrapEnvelope<RouteListResponse>(routeEnvelope).items.find(
          (route) => route.id === trip.route_id,
        ) ?? null,
      stops: unwrapEnvelope<RouteStopsListResponse>(stopsEnvelope).items,
      manifest: manifestEnvelope,
    };
  }, [tripId]);

  const live = useLiveTripTracking(tripId || null);
  const trip = data?.trip ?? null;

  const withAttendance = async (studentId: string, action: 'board' | 'drop') => {
    if (!trip) return;
    setBusyStudentId(studentId);
    try {
      if (action === 'board') {
        await apiClient.boardTripStudent(trip.id, studentId);
      } else {
        await apiClient.dropTripStudent(trip.id, studentId);
      }
      await reload();
    } catch (caught) {
      Alert.alert(
        action === 'board' ? 'Could not board student' : 'Could not drop student',
        getApiErrorMessage(caught),
      );
    } finally {
      setBusyStudentId(null);
    }
  };

  if (loading && !data) {
    return <LoadingView label="Loading trip…" />;
  }
  if (error || !data || !trip) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load this trip'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <Card title={data.route ? `${data.route.code} · ${data.route.name}` : 'Trip'}>
        <View style={styles.badgeRow}>
          <TripStatusBadge status={trip.status} />
          <TrackingStateBadge state={live.trackingState} />
          <ConnectionIndicator connection={live.connection} />
        </View>
        <View style={styles.kvRow}>
          <KeyValue label="Scheduled" value={formatTime(trip.scheduled_start_at)} />
          <KeyValue label="Date" value={formatDate(trip.scheduled_start_at)} />
          <KeyValue label="Driver" value={trip.driver_id ? trip.driver_id : '—'} />
          <KeyValue label="Conductor" value={trip.conductor_id ? trip.conductor_id : '—'} />
        </View>
      </Card>

      <TripStatusActions trip={trip} allowCancel onApplied={() => void reload()} />

      <SectionTitle>Live tracking</SectionTitle>
      <BusMap stops={data.stops} fix={live.fix} height={240} />
      <View style={styles.etaWrap}>
        <EtaSummaryCard eta={live.eta} fix={live.fix} />
      </View>

      <SectionTitle>Route stops</SectionTitle>
      <StopsEtaList eta={live.eta} />

      <SectionTitle>Student manifest</SectionTitle>
      {data.manifest ? (
        data.manifest.items.length === 0 ? (
          <EmptyState title="No students on this route" />
        ) : (
          <ManifestList
            manifest={data.manifest}
            canAct={isTripOpen(trip.status)}
            busyStudentId={busyStudentId}
            onBoard={(studentId) => void withAttendance(studentId, 'board')}
            onDrop={(studentId) => void withAttendance(studentId, 'drop')}
          />
        )
      ) : (
        <Text style={styles.muted}>The manifest could not be loaded.</Text>
      )}

      {trip.cancellation_reason ? (
        <Text style={styles.cancelReason}>Cancelled: {trip.cancellation_reason}</Text>
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
  kvRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  etaWrap: {
    marginTop: spacing.sm,
  },
  muted: {
    color: colors.neutral[500],
    fontSize: 14,
  },
  cancelReason: {
    color: colors.status.danger,
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
