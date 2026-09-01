import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  TripStatus,
  type TripListResponse,
  type TripResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../src/lib/errors';
import { formatTime, tripStatusLabel, utcDateOnly } from '../../src/lib/format';
import { useLoad } from '../../src/hooks/useLoad';
import { isTripOpen, ManifestList } from '../../src/features/crew';
import {
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingView,
  Screen,
  Select,
} from '../../src/components';

/**
 * School-admin attendance — mobile view of the web Attendance page. Pick one
 * of today's trips and record boarding / drop-off with the exact same
 * body-less endpoints the crew uses; the server timestamps every event.
 */
export default function AdminAttendanceScreen() {
  const [selectedId, setSelectedId] = useState('');
  const [statusFilter, setStatusFilter] = useState<TripStatus | 'ALL'>('ALL');
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  const tripsLoad = useLoad(async (): Promise<{ trips: TripResponse[] }> => {
    const tripsEnvelope = await apiClient.listTrips({ page: 1, limit: 50, date: utcDateOnly() });
    return { trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items };
  }, []);

  // The selection always resolves to a trip that survives the current filter,
  // otherwise the manifest below would show a trip the user just filtered out.
  const activeId = useMemo(() => {
    const trips = tripsLoad.data?.trips ?? [];
    const eligible =
      statusFilter === 'ALL' ? trips : trips.filter((trip) => trip.status === statusFilter);
    if (selectedId && eligible.some((trip) => trip.id === selectedId)) return selectedId;
    return eligible[0]?.id ?? '';
  }, [selectedId, tripsLoad.data, statusFilter]);

  const manifestLoad = useLoad(async (): Promise<TripStudentManifestResponse | null> => {
    if (!activeId) return null;
    return unwrapEnvelope<TripStudentManifestResponse>(
      await apiClient.listTripStudents(activeId),
    );
  }, [activeId]);

  const activeTrip = tripsLoad.data?.trips.find((trip) => trip.id === activeId) ?? null;

  const withAction = async (studentId: string, action: 'board' | 'drop') => {
    if (!activeId) return;
    setBusyStudentId(studentId);
    try {
      if (action === 'board') {
        await apiClient.boardTripStudent(activeId, studentId);
      } else {
        await apiClient.dropTripStudent(activeId, studentId);
      }
      await manifestLoad.reload();
    } catch (caught) {
      Alert.alert(
        action === 'board' ? 'Could not board student' : 'Could not drop student',
        getApiErrorMessage(caught),
      );
    } finally {
      setBusyStudentId(null);
    }
  };

  if (tripsLoad.loading && !tripsLoad.data) {
    return <LoadingView label="Loading trips…" />;
  }
  if (tripsLoad.error || !tripsLoad.data) {
    return (
      <Screen>
        <ErrorState
          message={tripsLoad.error ?? 'Could not load trips'}
          onRetry={() => void tripsLoad.reload()}
        />
      </Screen>
    );
  }

  if (tripsLoad.data.trips.length === 0) {
    return (
      <Screen refresh={() => void tripsLoad.reload()} refreshing={tripsLoad.loading}>
        <EmptyState
          title="No trips today"
          description="Attendance can be recorded once a trip is scheduled for today."
        />
      </Screen>
    );
  }

  const filteredTrips =
    statusFilter === 'ALL'
      ? tripsLoad.data.trips
      : tripsLoad.data.trips.filter((trip) => trip.status === statusFilter);

  const options = filteredTrips.map((trip) => ({
    value: trip.id,
    label: `${trip.route_code ?? 'Route'} · ${formatTime(trip.scheduled_start_at)} · ${tripStatusLabel(trip.status)}`,
  }));

  const selector = (
    <>
      <FilterChips<TripStatus | 'ALL'>
        options={[
          { value: 'ALL', label: `All · ${tripsLoad.data.trips.length}` },
          ...Object.values(TripStatus).map((status) => ({
            value: status as TripStatus | 'ALL',
            label: `${tripStatusLabel(status)} · ${tripsLoad.data!.trips.filter((trip) => trip.status === status).length}`,
          })),
        ]}
        value={statusFilter}
        onChange={setStatusFilter}
      />
      <Select
        label="Trip"
        value={activeId}
        onChange={setSelectedId}
        options={options}
        placeholder={options.length === 0 ? 'No trips match this filter' : 'Select a trip'}
      />
    </>
  );

  const manifest = manifestLoad.data;
  const hasStudents = Boolean(manifest && manifest.items.length > 0);

  if (hasStudents && manifest) {
    return (
      <View style={styles.flex}>
        <ManifestList
          manifest={manifest}
          canAct={activeTrip ? isTripOpen(activeTrip.status) : false}
          busyStudentId={busyStudentId}
          onBoard={(studentId) => void withAction(studentId, 'board')}
          onDrop={(studentId) => void withAction(studentId, 'drop')}
          header={selector}
          footer={
            activeTrip && !isTripOpen(activeTrip.status) ? (
              <Text style={styles.hint}>
                Boarding actions are available while the trip is boarding or in progress.
              </Text>
            ) : null
          }
          refresh={() => void manifestLoad.reload()}
          refreshing={manifestLoad.loading}
        />
      </View>
    );
  }

  return (
    <Screen refresh={() => void manifestLoad.reload()} refreshing={manifestLoad.loading}>
      {selector}
      {manifestLoad.loading && !manifestLoad.data ? (
        <LoadingView label="Loading manifest…" />
      ) : manifestLoad.error ? (
        <ErrorState message={manifestLoad.error} onRetry={() => void manifestLoad.reload()} />
      ) : (
        <EmptyState
          title="No students on this route"
          description="This trip's route has no students with a home stop on it yet."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hint: {
    color: colors.neutral[400],
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
