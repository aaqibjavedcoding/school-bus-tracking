import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { EmptyState, ErrorBanner, LoadingView } from '../../../../src/components/Feedback';
import { ConnectionBanner } from '../../../../src/components/ConnectionBanner';
import { Select } from '../../../../src/components/Select';
import { BusMap, MapLegend } from '../../../../src/features/map/BusMap';
import { StopProgressPanel } from '../../../../src/features/tracking/StopProgressPanel';
import { useParentHome } from '../../../../src/features/parent/use-parent-home';
import { useChildTracking } from '../../../../src/features/parent/use-child-tracking';
import {
  formatDistanceMeters,
  formatFixLine,
  formatSpeedKmh,
  formatTime,
  tripStatusTone,
  TRIP_STATUS_LABELS,
} from '../../../../src/utils/format';

/**
 * Parent live tracking (Task 23 §G) on top of `GET /parent/children/:id/
 * tracking` + the existing `/live-tracking` socket. The child selector only
 * lists children the API returned for this parent — ownership is never
 * asserted from the client.
 */
export default function ParentTrackingScreen() {
  const params = useLocalSearchParams<{ childId?: string }>();
  const home = useParentHome();
  const children = home.data?.children ?? [];
  const [picked, setPicked] = useState<string | null>(params.childId ?? null);

  const childId = useMemo(() => {
    if (picked && children.some((child) => child.id === picked)) {
      return picked;
    }
    return children[0]?.id ?? null;
  }, [picked, children]);

  const tracking = useChildTracking(childId);
  const selectedChild = children.find((child) => child.id === childId) ?? null;
  const snapshot = tracking.snapshot;

  if (home.loading && !home.data) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Finding today’s bus…" />
      </Screen>
    );
  }

  if (!tracking.loading && children.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="No children linked yet"
          message="Once your school links a child to your account, live tracking appears here."
          icon="🧒"
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ConnectionBanner socketReconnecting={tracking.live.connection === 'reconnecting'} />
      {tracking.error ? (
        <ErrorBanner message={tracking.error} onRetry={() => void tracking.refresh()} />
      ) : null}

      {children.length > 1 ? (
        <Select
          label="Child"
          options={children.map((child) => ({
            id: child.id,
            label: `${child.first_name} ${child.last_name}`,
            hint: child.home_stop?.name ?? undefined,
          }))}
          value={childId}
          onPick={(id) => setPicked(id)}
        />
      ) : null}

      {snapshot?.trip ? (
        <>
          <Card
            title={
              selectedChild
                ? `${selectedChild.first_name} ${selectedChild.last_name}`
                : 'Your child'
            }
            description={
              snapshot.trip.status
                ? `Trip ${TRIP_STATUS_LABELS[snapshot.trip.status]} · scheduled ${formatTime(snapshot.trip.scheduled_start_at)}`
                : undefined
            }
            right={
              <StatusBadge
                tone={tripStatusTone(snapshot.trip.status)}
                label={TRIP_STATUS_LABELS[snapshot.trip.status]}
              />
            }
          >
            <Text style={styles.fact}>
              Bus {snapshot.trip.bus_id ? '' : 'assignment pending'}
              {snapshot.conductor ? ` · Conductor ${snapshot.conductor.first_name}` : ''}
              {snapshot.driver ? ` · Driver ${snapshot.driver.first_name}` : ''}
            </Text>
            <View style={styles.positionRow}>
              <Text style={styles.position}>
                {formatFixLine(
                  tracking.position
                    ? {
                        latitude: tracking.position.latitude,
                        longitude: tracking.position.longitude,
                        speed: tracking.live.fix?.speed ?? null,
                        recorded_at: tracking.position.received_at,
                      }
                    : null,
                )}
              </Text>
              <StatusBadge
                compact
                tone={
                  tracking.position
                    ? tracking.position.source === 'live'
                      ? 'success'
                      : 'info'
                    : 'warning'
                }
                label={
                  tracking.position
                    ? tracking.position.source === 'live'
                      ? 'LIVE'
                      : 'LAST KNOWN'
                    : 'NO GPS YET'
                }
              />
            </View>
            {tracking.live.fix?.speed != null ? (
              <Text style={styles.fact}>Speed {formatSpeedKmh(tracking.live.fix.speed)}</Text>
            ) : null}
            {tracking.live.lastArrival ? (
              <Text style={styles.arrival}>
                Arrived at {tracking.live.lastArrival.stop_name} ·{' '}
                {formatTime(tracking.live.lastArrival.arrived_at)} ·{' '}
                {formatDistanceMeters(tracking.live.lastArrival.distance_meters)}
              </Text>
            ) : null}
          </Card>

          <Card
            title="Live map"
            description="Route, stops and the bus — drawn from backend coordinates only."
          >
            <BusMap
              stops={tracking.stops}
              bus={
                tracking.position
                  ? {
                      latitude: tracking.position.latitude,
                      longitude: tracking.position.longitude,
                      heading: tracking.live.fix?.heading ?? null,
                    }
                  : null
              }
              homeStopId={snapshot.child.home_stop?.id ?? null}
              currentStopId={tracking.eta?.current_stop?.stop_id ?? null}
              nextStopId={tracking.eta?.next_stop?.stop_id ?? null}
              geofenceRadiusByStopId={Object.fromEntries(
                (snapshot.stops ?? []).map((stop) => [stop.id, stop.geofence_radius_meters]),
              )}
              height={280}
              caption="Home stop in green · bus in amber"
            />
            <MapLegend />
          </Card>

          <StopProgressPanel progress={null} live={{ ...tracking.live, eta: tracking.eta }} />
        </>
      ) : (
        !tracking.loading && (
          <Card>
            <Text style={styles.noTripTitle}>No live trip for today</Text>
            <Text style={styles.noTripBody}>
              {snapshot
                ? 'Your child has no trip scheduled today (or it is not active right now). Positions appear the moment the bus starts moving.'
                : 'Loading the tracking snapshot from the school…'}
            </Text>
          </Card>
        )
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fact: {
    fontSize: 13,
    color: colors.neutral[600],
    marginBottom: spacing.xs,
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  position: {
    flex: 1,
    fontSize: 12,
    color: colors.neutral[500],
  },
  arrival: {
    marginTop: spacing.xs,
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary[700],
  },
  noTripTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  noTripBody: {
    fontSize: 13,
    color: colors.neutral[600],
    lineHeight: 20,
  },
});
