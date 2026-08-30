import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import {
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
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  const tripsLoad = useLoad(async (): Promise<{ trips: TripResponse[] }> => {
    const tripsEnvelope = await apiClient.listTrips({ page: 1, limit: 50, date: utcDateOnly() });
    return { trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items };
  }, []);

  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    return tripsLoad.data?.trips[0]?.id ?? '';
  }, [selectedId, tripsLoad.data]);

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

  const options = tripsLoad.data.trips.map((trip) => ({
    value: trip.id,
    label: `${trip.route_code ?? 'Route'} · ${formatTime(trip.scheduled_start_at)} · ${tripStatusLabel(trip.status)}`,
  }));

  return (
    <Screen refresh={() => void manifestLoad.reload()} refreshing={manifestLoad.loading}>
      <Select
        label="Trip"
        value={activeId}
        onChange={setSelectedId}
        options={options}
        placeholder="Select a trip"
      />

      {manifestLoad.loading && !manifestLoad.data ? (
        <LoadingView label="Loading manifest…" />
      ) : manifestLoad.error ? (
        <ErrorState message={manifestLoad.error} onRetry={() => void manifestLoad.reload()} />
      ) : !manifestLoad.data || manifestLoad.data.items.length === 0 ? (
        <EmptyState
          title="No students on this route"
          description="This trip's route has no students with a home stop on it yet."
        />
      ) : (
        <>
          <ManifestList
            manifest={manifestLoad.data}
            canAct={activeTrip ? isTripOpen(activeTrip.status) : false}
            busyStudentId={busyStudentId}
            onBoard={(studentId) => void withAction(studentId, 'board')}
            onDrop={(studentId) => void withAction(studentId, 'drop')}
          />
          {activeTrip && !isTripOpen(activeTrip.status) ? (
            <Text style={styles.hint}>
              Boarding actions are available while the trip is boarding or in progress.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: colors.neutral[400],
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
