import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { invalidIdMessage, isUuid } from '../../../src/lib/ids';
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
 *
 * **One scroll owner.** The manifest is a `SectionList`, so as soon as it has
 * rows it owns the screen's scrolling and the cockpit above it is passed in
 * as the list's header. Only when there is no manifest to virtualize does the
 * screen fall back to the plain `<Screen>` ScrollView. See
 * `src/components/scroll-owner.spec.ts`, which pins that invariant for every
 * screen that mounts a virtualized list.
 */
export default function AdminTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const tripId = typeof id === 'string' ? id : '';
  // Never call the API without a real UUID — an empty `:id` can resolve to
  // the trips *list* endpoint and returns a shape this screen cannot render.
  const usableId = isUuid(tripId);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);

  const { data, loading, refreshing, error, reload, refresh } = useLoad(async (): Promise<{
    trip: TripResponse;
    route: RouteResponse | null;
    stops: StopResponse[];
    manifest: TripStudentManifestResponse | null;
  }> => {
    if (!usableId) {
      throw new Error(invalidIdMessage('trip'));
    }
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
  }, [tripId, usableId]);

  const live = useLiveTripTracking(usableId ? tripId : null);
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

  /**
   * Everything above the manifest — the cockpit chrome. It is built once and
   * handed to *whichever* scroll surface renders it, which is what keeps the
   * two layouts below identical in content and only different in container.
   */
  const cockpit = (
    <>
      {/* Detail routes hidden from the tab bar get no automatic back button
          (the group is a tab navigator, not a stack) — offer one explicitly. */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.backRow}
      >
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>

      <Card title={data.route ? `${data.route.code} · ${data.route.name}` : 'Trip'}>
        <View style={styles.badgeRow}>
          <TripStatusBadge status={trip.status} />
          <TrackingStateBadge state={live.trackingState} />
          <ConnectionIndicator connection={live.connection} />
        </View>
        <View style={styles.kvRow}>
          <KeyValue label="Scheduled" value={formatTime(trip.scheduled_start_at)} />
          <KeyValue label="Date" value={formatDate(trip.scheduled_start_at)} />
          <KeyValue label="Driver" value={trip.driver_name ?? '—'} />
          <KeyValue label="Conductor" value={trip.conductor_name ?? '—'} />
        </View>
        <View style={styles.kvRow}>
          <KeyValue label="Bus" value={trip.registration_number ?? trip.bus_number ?? '—'} />
        </View>
      </Card>

      <TripStatusActions trip={trip} allowCancel onApplied={() => void reload()} />

      <SectionTitle>Live tracking</SectionTitle>
      <BusMap
        stops={data.stops}
        fix={live.fix}
        height={240}
        tripId={tripId}
        connection={live.connection}
      />
      <View style={styles.etaWrap}>
        <EtaSummaryCard eta={live.eta} fix={live.fix} />
      </View>

      <SectionTitle>Route stops</SectionTitle>
      <StopsEtaList eta={live.eta} />

      <SectionTitle>Student manifest</SectionTitle>
    </>
  );

  const cancellation = trip.cancellation_reason ? (
    <Text style={styles.cancelReason}>Cancelled: {trip.cancellation_reason}</Text>
  ) : null;

  // One scroll owner per screen. `ManifestList` is a `SectionList` (a
  // virtualized list), so when there are rows to show it *becomes* the
  // screen's scroll surface and the cockpit above it rides along as its
  // `ListHeaderComponent` — the same arrangement the crew manifest and the
  // admin attendance screens already use. Wrapping it in `<Screen>` (a plain
  // vertical ScrollView) instead nests two same-direction scrollers and makes
  // React Native warn "VirtualizedLists should never be nested inside plain
  // ScrollViews", while also losing row recycling for a long manifest.
  if (data.manifest && data.manifest.items.length > 0) {
    return (
      <View style={styles.flex}>
        <ManifestList
          manifest={data.manifest}
          canAct={isTripOpen(trip.status)}
          busyStudentId={busyStudentId}
          onBoard={(studentId) => void withAttendance(studentId, 'board')}
          onDrop={(studentId) => void withAttendance(studentId, 'drop')}
          header={cockpit}
          footer={cancellation}
          refresh={() => void refresh()}
          refreshing={refreshing}
        />
      </View>
    );
  }

  // No virtualized list below, so the plain scrolling screen is correct here
  // and the cockpit keeps its usual layout.
  return (
    <Screen refresh={() => void refresh()} refreshing={refreshing}>
      {cockpit}
      {data.manifest ? (
        <EmptyState title="No students on this route" />
      ) : (
        <Text style={styles.muted}>The manifest could not be loaded.</Text>
      )}
      {cancellation}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    paddingVertical: 2,
  },
  backText: {
    color: colors.secondary[700],
    fontSize: 14,
    fontWeight: '600',
  },
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
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
