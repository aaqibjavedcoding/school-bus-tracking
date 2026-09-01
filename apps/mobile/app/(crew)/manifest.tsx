import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { UserRole, type TripStudentManifestResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import { isTripOpen, ManifestList, manifestCounts, useCrewToday } from '../../src/features/crew';
import { useAuth } from '../../src/features/auth';
import { crewRoleLabel } from '../../src/lib/roles';
import { EmptyState, ErrorState, LoadingView, Screen, TripStatusBadge } from '../../src/components';

/**
 * Student manifest of the crew member's today trip, with board/drop.
 *
 * The manifest itself is derived server-side from the trip's route and
 * stops; the board/drop calls are body-less — the API records who (JWT
 * subject) and when (server clock). Allowed only while the trip is open.
 *
 * Task 44 keeps one manifest for both crew roles — the conductor's daily
 * tool, the driver's window onto who is on board — and only the framing
 * changes: the conductor is told to record attendance, the driver is shown
 * the head-count they are carrying.
 */
export default function CrewManifestScreen() {
  const { user } = useAuth();
  const isDriver = user?.role === UserRole.DRIVER;
  const {
    data: today,
    loading: todayLoading,
    error: todayError,
    reload: reloadToday,
  } = useCrewToday();
  const trip = today?.trip ?? null;

  const manifestLoad = useLoad<TripStudentManifestResponse | null>(async () => {
    if (!trip) {
      return null;
    }
    return unwrapEnvelope(await apiClient.listTripStudents(trip.id));
  }, [trip?.id]);

  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  const withAction = async (studentId: string, action: 'board' | 'drop') => {
    if (!trip) return;
    setBusyStudentId(studentId);
    try {
      if (action === 'board') {
        await apiClient.boardTripStudent(trip.id, studentId);
      } else {
        await apiClient.dropTripStudent(trip.id, studentId);
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

  if (todayLoading && !today) {
    return <LoadingView label="Loading manifest…" />;
  }
  if (todayError || !today) {
    return (
      <Screen>
        <ErrorState
          message={todayError ?? 'Could not load your trip'}
          onRetry={() => void reloadToday()}
        />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen refresh={() => void reloadToday()} refreshing={todayLoading}>
        <EmptyState title="No trip today" description="There is no manifest without a trip." />
      </Screen>
    );
  }

  const manifest = manifestLoad.data;
  const counts = manifest ? manifestCounts(manifest.items) : null;

  if (manifest && manifest.items.length > 0) {
    return (
      <View style={styles.flex}>
        <ManifestList
          manifest={manifest}
          canAct={isTripOpen(manifest.trip_status)}
          busyStudentId={busyStudentId}
          onBoard={(studentId) => void withAction(studentId, 'board')}
          onDrop={(studentId) => void withAction(studentId, 'drop')}
          header={
            <>
              <Text style={styles.role}>
                {user ? `${crewRoleLabel(user.role)} · ` : ''}
                {isDriver ? 'Students on board' : 'Boarding & drop'}
              </Text>
              <Text style={styles.hint}>
                {isDriver
                  ? 'The head-count you are carrying. Ask the conductor before moving off.'
                  : 'Tap board when a student gets on and drop when they get off — the time is recorded automatically.'}
              </Text>
              <TripStatusBadge status={manifest.trip_status} />
              {counts ? (
                <Text style={styles.counts}>
                  {counts.boarded} boarded · {counts.pending} waiting · {counts.dropped} dropped
                </Text>
              ) : null}
            </>
          }
          refresh={() => {
            void reloadToday();
            void manifestLoad.reload();
          }}
          refreshing={manifestLoad.loading || todayLoading}
        />
      </View>
    );
  }

  return (
    <Screen
      refresh={() => {
        void reloadToday();
        void manifestLoad.reload();
      }}
      refreshing={manifestLoad.loading || todayLoading}
    >
      {manifest ? (
        <EmptyState
          title="No students on this route"
          description="Every manifest entry comes from active students whose home stop belongs to this route."
        />
      ) : manifestLoad.loading ? (
        <LoadingView label="Loading manifest…" />
      ) : manifestLoad.error ? (
        <ErrorState message={manifestLoad.error} onRetry={() => void manifestLoad.reload()} />
      ) : (
        <EmptyState title="Manifest unavailable" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  role: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  hint: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  counts: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
});
