import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import { useCrewToday } from '../../src/features/crew';
import { useAuth } from '../../src/features/auth';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
import { EtaSummaryCard, StopsEtaList } from '../../src/features/tracking/EtaViews';
import type {
  TripStopArrivalListResponse,
  TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import {
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SectionTitle,
  TrackingStateBadge,
} from '../../src/components';
import { formatDistanceMeters, formatTime } from '../../src/lib/format';
import { useTranslation } from '../../src/lib/i18n-provider';

/**
 * Route stops of the crew's today trip with the live ETA stream.
 *
 * Current/next stop, per-stop ETAs and geofence arrivals all come from the
 * existing Task 22 backend (`/trips/:id/eta` + `trip:eta:update` /
 * `trip:stop:arrived` pushes). The device's own GPS feed powers those
 * numbers server-side — nothing is estimated on the client.
 */
export default function CrewStopsScreen() {
  const t = useTranslation();
  const { user } = useAuth();
  const {
    data: today,
    loading: todayLoading,
    refreshing: todayRefreshing,
    error: todayError,
    reload: reloadToday,
    refresh: refreshToday,
  } = useCrewToday(user?.school_timezone);
  const trip = today?.trip ?? null;

  const live = useLiveTripTracking(trip?.id ?? null);

  const arrivalsLoad = useLoad<TripStopArrivalListResponse | null>(async () => {
    if (!trip) {
      return null;
    }
    return unwrapEnvelope(await apiClient.getTripArrivals(trip.id));
  }, [trip?.id]);

  // The whole manifest, for the per-stop "N kids" badge and the tap-to-expand
  // names (N6). Crew-only by construction: this screen is the only caller
  // that passes `students`, so parent/admin lists never render children.
  const manifestLoad = useLoad<TripStudentManifestResponse['items']>(async () => {
    if (!trip) {
      return [];
    }
    return unwrapEnvelope(await apiClient.listTripStudents(trip.id)).items;
  }, [trip?.id]);

  if (todayLoading && !today) {
    return <LoadingView label={t('stops.loading')} />;
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
          icon="location-outline"
          title={t('stops.empty.title')}
          description={t('stops.empty.body')}
        />
      </Screen>
    );
  }

  const arrivals = [...(arrivalsLoad.data?.items ?? [])].reverse();

  return (
    <Screen
      refresh={() => {
        void refreshToday();
        void arrivalsLoad.refresh();
        void manifestLoad.refresh();
      }}
      refreshing={todayRefreshing || arrivalsLoad.refreshing || manifestLoad.refreshing}
    >
      <View style={styles.headerRow}>
        <ConnectionIndicator connection={live.connection} />
        <TrackingStateBadge state={live.trackingState} />
      </View>

      <SectionTitle>{t('stops.currentAndNext')}</SectionTitle>
      <EtaSummaryCard eta={live.eta} fix={live.fix} />
      {live.error ? <Text style={styles.error}>{live.error}</Text> : null}

      <SectionTitle>{t('stops.routeStops')}</SectionTitle>
      <StopsEtaList eta={live.eta} students={manifestLoad.data ?? undefined} />

      <SectionTitle>{t('stops.arrivals')}</SectionTitle>
      {arrivals.length === 0 ? (
        <Text style={styles.muted}>{t('stops.noArrivals')}</Text>
      ) : (
        <View style={styles.arrivalsCard}>
          {arrivals.map((arrival) => (
            <View key={arrival.id} style={styles.arrivalRow}>
              <Text style={styles.arrivalName}>{arrival.stop_name}</Text>
              <Text style={styles.arrivalMeta}>
                {t('stops.arrivalMeta', {
                  time: formatTime(arrival.arrived_at),
                  distance: formatDistanceMeters(arrival.distance_meters),
                })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  error: {
    color: colors.status.danger,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  muted: {
    color: colors.neutral[600],
    fontSize: 14,
  },
  arrivalsCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  arrivalRow: {
    gap: 2,
  },
  arrivalName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  arrivalMeta: {
    fontSize: 14,
    color: colors.neutral[600],
  },
});
