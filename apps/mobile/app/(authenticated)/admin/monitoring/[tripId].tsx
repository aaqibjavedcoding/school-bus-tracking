import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { EmptyState, ErrorBanner, LoadingView } from '../../../../src/components/Feedback';
import { ConnectionBanner } from '../../../../src/components/ConnectionBanner';
import { BusMap, MapLegend, type MapStop } from '../../../../src/features/map/BusMap';
import { StopProgressPanel } from '../../../../src/features/tracking/StopProgressPanel';
import { ManifestPanel } from '../../../../src/features/crew/ManifestPanel';
import {
  formatFixLine,
  formatTime,
  tripStatusTone,
  TRIP_STATUS_LABELS,
} from '../../../../src/utils/format';
import { useTripWorkspace } from '../../../../src/features/crew/use-trip-workspace';

/**
 * Read-only live view of one trip for the admin (Task 23 §C): the map renders
 * driver-reported positions exactly as the parents see them; manifest and
 * progress come from the same endpoints the crew app uses. Lifecycle control
 * lives on the trip detail screen — this view never writes.
 */
export default function AdminLiveMonitoringScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspace = useTripWorkspace(tripId ?? '', { canOperate: false });
  const { trip, route, bus, manifest, progress, routeStops, loading, error, refresh, live } =
    workspace;

  if (!tripId) {
    return <EmptyState title="Missing trip" icon="🗺️" />;
  }
  if (loading && !trip) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Loading live view…" />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen scroll={false}>
        <EmptyState
          title="Trip unavailable"
          message="It may have completed or been removed."
          icon="🗺️"
        />
      </Screen>
    );
  }

  const mapStops: MapStop[] = routeStops
    .filter((stop) => stop.latitude !== null && stop.longitude !== null)
    .map((stop) => ({
      id: stop.id,
      name: stop.name,
      sequence: stop.sequence_number,
      latitude: stop.latitude as number,
      longitude: stop.longitude as number,
    }));

  return (
    <Screen>
      <ConnectionBanner socketReconnecting={live.connection === 'reconnecting'} />
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
      <Card
        title={`${route?.name ?? 'Route'} · live`}
        description={route?.code}
        right={
          <StatusBadge
            tone={tripStatusTone(trip.status)}
            label={TRIP_STATUS_LABELS[trip.status]}
            compact
          />
        }
      >
        <Text style={styles.meta}>
          {bus?.bus_number
            ? `Bus ${bus.bus_number}`
            : (bus?.registration_number ?? 'No bus assigned')}{' '}
          · left {trip.actual_start_at ? formatTime(trip.actual_start_at) : '—'}
        </Text>
        <Text style={styles.meta}>{formatFixLine(live.fix)}</Text>
        {live.fix ? null : (
          <Text style={styles.stale}>
            {live.noLocationYet
              ? 'Trip is open but the driver has not reported a position yet.'
              : 'No live feed — the view falls back to the REST snapshot.'}
          </Text>
        )}
      </Card>

      <BusMap
        stops={mapStops}
        bus={
          live.fix
            ? {
                latitude: live.fix.latitude,
                longitude: live.fix.longitude,
                heading: live.fix.heading,
              }
            : null
        }
        currentStopId={progress?.current_stop?.stop_id ?? null}
        nextStopId={progress?.next_stop?.stop_id ?? null}
        geofenceRadiusByStopId={Object.fromEntries(
          routeStops.map((stop) => [stop.id, stop.geofence_radius_meters]),
        )}
        height={260}
        caption="Driver-reported positions — shown exactly as sent"
      />
      <MapLegend />

      <StopProgressPanel progress={progress} live={live} />

      <Card title="Manifest" description="Live as the crew records boardings.">
        <ManifestPanel
          manifest={manifest}
          tripStatus={trip.status}
          canRecord={false}
          busyStudentId={null}
          onAction={async () => undefined}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    fontSize: 13,
    color: colors.neutral[700],
  },
  stale: {
    fontSize: 12,
    color: colors.status.warning,
    marginTop: spacing.xs,
  },
});
