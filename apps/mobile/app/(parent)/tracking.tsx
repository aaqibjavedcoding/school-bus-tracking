import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type {
  ParentChildListResponse,
  ParentChildSummary,
  ParentTrackingResponse,
  TripLocationLatestResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import { BusMap } from '../../src/features/map/BusMap';
import { useLiveTripTracking, type LiveFix } from '../../src/features/tracking/useLiveTripTracking';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
import { EtaSummaryCard, StopsEtaList } from '../../src/features/tracking/EtaViews';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SectionTitle,
  TripStatusBadge,
} from '../../src/components';
import { fullName } from '../../src/lib/format';

function toLiveFix(latest: TripLocationLatestResponse | null): LiveFix | null {
  if (!latest) {
    return null;
  }
  return {
    latitude: latest.latitude,
    longitude: latest.longitude,
    heading: latest.heading ?? null,
    speed: latest.speed ?? null,
    accuracy: latest.accuracy ?? null,
    recorded_at: latest.recorded_at,
    received_at: latest.received_at,
  };
}

/**
 * Live bus tracking for a parent's child: the existing
 * `/parent/children/:id/tracking` snapshot (trip, route stops, crew, latest
 * verified fix, ETA) refreshed in realtime through the same `/live-tracking`
 * socket room the web app uses. No fix is ever fabricated — before the crew
 * device reports, the screen says so.
 */
export default function ParentTrackingScreen() {
  const params = useLocalSearchParams<{ child?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(
    typeof params.child === 'string' && params.child ? params.child : null,
  );

  const childrenLoad = useLoad<ParentChildListResponse>(async () => {
    return unwrapEnvelope(await apiClient.listParentChildren());
  }, []);

  const children = childrenLoad.data?.items ?? [];

  useEffect(() => {
    if (!selectedId && children.length > 0) {
      setSelectedId(children[0].id);
    }
  }, [children, selectedId]);

  const trackingLoad = useLoad<ParentTrackingResponse | null>(async () => {
    if (!selectedId) {
      return null;
    }
    return unwrapEnvelope(await apiClient.getParentChildTracking(selectedId));
  }, [selectedId]);

  const tracking = trackingLoad.data;
  const tripId = tracking?.trip?.id ?? null;
  const live = useLiveTripTracking(tripId);

  const fix: LiveFix | null = live.fix ?? toLiveFix(tracking?.latest ?? null);
  const eta = live.eta ?? tracking?.eta ?? null;
  const stops = useMemo(() => tracking?.stops ?? [], [tracking]);

  if (childrenLoad.loading && !childrenLoad.data) {
    return <LoadingView label="Loading your children…" />;
  }
  if (childrenLoad.error && !children) {
    return (
      <Screen>
        <ErrorState message={childrenLoad.error} onRetry={() => void childrenLoad.reload()} />
      </Screen>
    );
  }
  if (children.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="No children linked"
          description="Ask your school to link your children to your account to follow their bus."
        />
      </Screen>
    );
  }

  return (
    <Screen
      refresh={() => {
        void childrenLoad.reload();
        void trackingLoad.reload();
      }}
      refreshing={trackingLoad.loading}
    >
      <View style={styles.picker}>
        {children.map((child: ParentChildSummary) => (
          <Pressable
            key={child.id}
            onPress={() => setSelectedId(child.id)}
            style={[styles.chip, selectedId === child.id ? styles.chipActive : null]}
          >
            <Text style={[styles.chipText, selectedId === child.id ? styles.chipTextActive : null]}>
              {child.first_name}
            </Text>
          </Pressable>
        ))}
      </View>

      {trackingLoad.error ? (
        <ErrorState message={trackingLoad.error} onRetry={() => void trackingLoad.reload()} />
      ) : trackingLoad.loading && !tracking ? (
        <LoadingView label="Locating the bus…" />
      ) : !tracking ? (
        <EmptyState title="Tracking unavailable" />
      ) : !tracking.trip ? (
        <EmptyState
          title="No trip right now"
          description="There is no trip for this child today. Tracking starts as soon as the crew begins the run."
        />
      ) : (
        <>
          <Card title={tracking.child.home_stop.route_name ?? 'Bus trip'}>
            <View style={styles.statusRow}>
              <TripStatusBadge status={tracking.trip.status} />
              <ConnectionIndicator connection={live.connection} />
            </View>
            {tracking.driver ? (
              <Text style={styles.crewLine}>Driver: {fullName(tracking.driver)}</Text>
            ) : null}
            {tracking.conductor ? (
              <Text style={styles.crewLine}>Conductor: {fullName(tracking.conductor)}</Text>
            ) : null}
          </Card>

          <BusMap stops={stops} fix={fix} height={280} busTitle="School bus" />

          {fix ? null : (
            <Text style={styles.waiting}>
              Waiting for the crew device to share GPS — the position appears here the moment the
              bus starts reporting.
            </Text>
          )}

          <SectionTitle>ETA &amp; next stop</SectionTitle>
          <EtaSummaryCard eta={eta} fix={fix} />

          <SectionTitle>Route stops</SectionTitle>
          <StopsEtaList eta={eta} />

          <Button
            label="Refresh"
            variant="ghost"
            small
            onPress={() => void trackingLoad.reload()}
            style={styles.refreshButton}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  chipActive: {
    backgroundColor: colors.neutral[900],
    borderColor: colors.neutral[900],
  },
  chipText: {
    color: colors.neutral[700],
    fontWeight: '600',
    fontSize: 13,
  },
  chipTextActive: {
    color: '#ffffff',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  crewLine: {
    color: colors.neutral[600],
    fontSize: 13,
    marginTop: 2,
  },
  waiting: {
    color: colors.neutral[500],
    fontSize: 13,
    textAlign: 'center',
    marginVertical: spacing.sm,
  },
  refreshButton: {
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
});
