import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { UserRole, type TripStudentManifestResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { withIdempotencyKey } from '@school-bus-tracking/api-client';
import { apiClient } from '../../src/services/api';
import { getLocalizedApiError, unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import { isTripOpen, ManifestList, manifestCounts, useCrewToday } from '../../src/features/crew';
import { OfflineSyncBanner, useOfflineAction } from '../../src/features/crew/offline';
import { useToast } from '../../src/components';
import { useAuth } from '../../src/features/auth';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { crewRoleLabel } from '../../src/lib/roles';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  TripStatusBadge,
} from '../../src/components';
import { useTranslation } from '../../src/lib/i18n-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';

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
  /**
   * `?stopId=` — the next-stop deep link from the navigation card's
   * "mark attendance" prompt (PR 3). It only narrows the list; the full
   * manifest is one tap away, so nothing is ever hidden for good.
   */
  const { stopId } = useLocalSearchParams<{ stopId?: string }>();
  const router = useRouter();
  const t = useTranslation();
  const isDriver = user?.role === UserRole.DRIVER;
  const {
    data: today,
    loading: todayLoading,
    refreshing: todayRefreshing,
    error: todayError,
    reload: reloadToday,
    refresh: refreshToday,
  } = useCrewToday(user?.school_timezone);
  const trip = today?.trip ?? null;

  const manifestLoad = useLoad<TripStudentManifestResponse | null>(async () => {
    if (!trip) {
      return null;
    }
    return unwrapEnvelope(await apiClient.listTripStudents(trip.id));
  }, [trip?.id]);

  /**
   * Cross-device attendance (the whole point of the shared trip room).
   *
   * The conductor boards a child on their phone; the driver's manifest was
   * the one surface that stayed frozen until a pull-to-refresh, because the
   * REST write lives on the other device. The server now broadcast the
   * change into `trip:<tripId>` (`trip:student:attendance`) — the same room
   * the stop arrivals already travel through — so this screen refetches the
   * manifest the moment a frame lands. The device's *own* writes already
   * reload below after a confirmed action, so for them this is one extra
   * cheap read at most.
   */
  const live = useLiveTripTracking(trip?.id ?? null);
  const lastStudentAttendance = live.lastStudentAttendance;
  React.useEffect(() => {
    if (!lastStudentAttendance) return;
    void manifestLoad.reload();
  }, [lastStudentAttendance, manifestLoad.reload]);

  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  // Students whose action currently sits in the offline queue — the row shows
  // "⏳ saved offline" until the server confirms the event on the next reload.
  const [queuedIds, setQueuedIds] = useState<ReadonlySet<string>>(new Set());
  const offline = useOfflineAction();
  const toast = useToast();

  // Online-first with an offline fallback: the board/drop call carries the
  // idempotency key of its queue reservation, so a lost response is replayed
  // as a dedupe hit and the manifest can never double-record a student.
  const withAction = async (studentId: string, action: 'board' | 'drop') => {
    if (!trip) return;
    setBusyStudentId(studentId);
    try {
      const result = await offline.execute(
        {
          kind: 'attendance',
          userId: user?.id ?? null,
          tripId: trip.id,
          studentId,
          eventType: action,
        },
        (key) =>
          action === 'board'
            ? apiClient.boardTripStudent(trip.id, studentId, withIdempotencyKey(key))
            : apiClient.dropTripStudent(trip.id, studentId, withIdempotencyKey(key)),
      );
      if (result.mode === 'queued') {
        setQueuedIds((previous) => new Set(previous).add(studentId));
        toast.push(
          action === 'board' ? t('manifest.queuedBoardToast') : t('manifest.queuedDropToast'),
          'info',
        );
        return;
      }
      await manifestLoad.reload();
    } catch (caught) {
      // Known server codes get local copy; an unknown one is shown as-is with
      // its raw code appended, never silently dropped.
      const localized = getLocalizedApiError(caught);
      Alert.alert(
        action === 'board' ? t('manifest.boardFailed') : t('manifest.dropFailed'),
        localized.codeNote ? `${localized.message}\n\n${localized.codeNote}` : localized.message,
      );
    } finally {
      setBusyStudentId(null);
    }
  };

  if (todayLoading && !today) {
    return <LoadingView label={t('manifest.loading')} />;
  }
  if (todayError || !today) {
    return (
      <Screen>
        <ErrorState
          legible
          message={todayError ?? t('manifest.loadError')}
          onRetry={() => void reloadToday()}
        />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen refresh={() => void refreshToday()} refreshing={todayRefreshing}>
        <EmptyState
          legible
          icon="people-outline"
          title={t('manifest.empty.tripTitle')}
          description={t('manifest.empty.tripBody')}
        />
      </Screen>
    );
  }

  const loaded = manifestLoad.data;
  const stopFilterName =
    stopId && loaded
      ? (loaded.items.find((item) => item.stop_id === stopId)?.stop_name ?? null)
      : null;
  const manifest =
    loaded && stopId
      ? { ...loaded, items: loaded.items.filter((item) => item.stop_id === stopId) }
      : loaded;
  const counts = manifest ? manifestCounts(manifest.items) : null;

  if (manifest && manifest.items.length > 0) {
    return (
      <View style={styles.flex}>
        <ManifestList
          manifest={manifest}
          canAct={isTripOpen(manifest.trip_status)}
          busyStudentId={busyStudentId}
          queuedStudentIds={queuedIds}
          onBoard={(studentId) => void withAction(studentId, 'board')}
          onDrop={(studentId) => void withAction(studentId, 'drop')}
          header={
            <>
              <OfflineSyncBanner />
              <Text style={styles.role}>
                {user ? `${crewRoleLabel(user.role)} · ` : ''}
                {isDriver ? t('nav.manifest.titleDriver') : t('nav.manifest.titleConductor')}
              </Text>
              <Text style={styles.hint}>
                {isDriver ? t('manifest.hint.driver') : t('manifest.hint.conductor')}
              </Text>
              {stopId ? (
                <Text style={styles.hint}>
                  {t('manifest.filter.stopOnly', { stop: stopFilterName ?? '' })}
                </Text>
              ) : null}
              {stopId ? (
                <Button
                  label={t('manifest.filter.showAll')}
                  icon="people"
                  variant="ghost"
                  onPress={() => router.setParams({ stopId: '' })}
                />
              ) : null}
              <TripStatusBadge size="lg" status={manifest.trip_status} />
              {counts ? (
                <Text style={styles.counts}>
                  {t('manifest.counts', {
                    boarded: counts.boarded,
                    pending: counts.pending,
                    dropped: counts.dropped,
                  })}
                </Text>
              ) : null}
            </>
          }
          refresh={() => {
            void refreshToday();
            void manifestLoad.refresh();
          }}
          refreshing={manifestLoad.refreshing || todayRefreshing}
        />
      </View>
    );
  }

  return (
    <Screen
      refresh={() => {
        void refreshToday();
        void manifestLoad.refresh();
      }}
      refreshing={manifestLoad.refreshing || todayRefreshing}
    >
      {manifest ? (
        <EmptyState
          title={t('manifest.empty.studentsTitle')}
          description={t('manifest.empty.studentsBody')}
        />
      ) : manifestLoad.loading ? (
        <LoadingView label={t('manifest.loading')} />
      ) : manifestLoad.error ? (
        <ErrorState message={manifestLoad.error} onRetry={() => void manifestLoad.reload()} />
      ) : (
        <EmptyState title={t('manifest.unavailable')} />
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
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  counts: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[700],
    fontWeight: '600',
    marginTop: spacing.xs,
  },
});
