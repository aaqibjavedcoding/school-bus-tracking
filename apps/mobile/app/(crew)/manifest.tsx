import React, { useState } from 'react';
import { Alert } from 'react-native';
import type { TripStudentManifestResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../src/services/api';
import { getApiErrorMessage, unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import { isTripOpen, ManifestList, useCrewToday } from '../../src/features/crew';
import { EmptyState, ErrorState, LoadingView, Screen, TripStatusBadge } from '../../src/components';

/**
 * Student manifest of the crew member's today trip, with board/drop.
 *
 * The manifest itself is derived server-side from the trip's route and
 * stops; the board/drop calls are body-less — the API records who (JWT
 * subject) and when (server clock). Allowed only while the trip is open.
 */
export default function CrewManifestScreen() {
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

  return (
    <Screen
      refresh={() => {
        void reloadToday();
        void manifestLoad.reload();
      }}
      refreshing={manifestLoad.loading || todayLoading}
    >
      {manifest ? (
        <>
          <TripStatusBadge status={manifest.trip_status} />
          {manifestLoad.error ? (
            <ErrorState message={manifestLoad.error} onRetry={() => void manifestLoad.reload()} />
          ) : (
            <ManifestList
              manifest={manifest}
              canAct={isTripOpen(manifest.trip_status)}
              busyStudentId={busyStudentId}
              onBoard={(studentId) => void withAction(studentId, 'board')}
              onDrop={(studentId) => void withAction(studentId, 'drop')}
            />
          )}
          {manifest.items.length === 0 ? (
            <EmptyState
              title="No students on this route"
              description="Every manifest entry comes from active students whose home stop belongs to this route."
            />
          ) : null}
        </>
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
