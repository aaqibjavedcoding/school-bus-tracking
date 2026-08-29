import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { Screen } from '../../components/Screen';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { ConnectionBanner } from '../../components/ConnectionBanner';
import { ErrorBanner, LoadingView } from '../../components/Feedback';
import { useToast } from '../../components/Toast';
import { TripStatusControls } from './TripStatusControls';
import { ManifestPanel } from './ManifestPanel';
import { GpsPanel } from './GpsPanel';
import { StopProgressPanel } from '../tracking/StopProgressPanel';
import { BusMap, MapLegend, type MapStop } from '../map/BusMap';
import { useTripWorkspace } from './use-trip-workspace';
import { getGpsTracker } from '../../gps/registry';
import {
  formatDateTime,
  formatFixLine,
  tripStatusTone,
  TRIP_STATUS_LABELS,
} from '../../utils/format';

/**
 * The operational trip screen shared by Driver and Conductor (Task 23 §D/F).
 *
 * Mode differences are *permission-shaped, not API-shaped*: the conductor gets
 * the same manifest + attendance actions (the backend's `@Roles` allows
 * rostered crew) but never the GPS sharing control (a driver duty) and never
 * the lifecycle buttons (kept driver/admin-facing on mobile; the backend would
 * still validate anything either role attempts).
 */
export const TripWorkspaceScreen: React.FC<{ tripId: string; mode: 'driver' | 'conductor' }> = ({
  tripId,
  mode,
}) => {
  const workspace = useTripWorkspace(tripId, { canOperate: true });
  const toast = useToast();
  const {
    trip,
    route,
    bus,
    manifest,
    progress,
    routeStops,
    loading,
    error,
    refresh,
    live,
    network,
    allowedNextStatuses,
    canOperate,
    setStatus,
    actOnStudent,
    busyStudentId,
    lastActionMessage,
    clearLastActionMessage,
  } = workspace;

  React.useEffect(() => {
    if (lastActionMessage) {
      toast.show(lastActionMessage, 'danger');
      clearLastActionMessage();
    }
  }, [lastActionMessage, toast, clearLastActionMessage]);

  const handleTransition = useCallback(
    async (next: TripStatus, reason?: string | null): Promise<boolean> => {
      const ok = await setStatus(next, reason);
      if (ok) {
        toast.show(`${TRIP_STATUS_LABELS[next]} — confirmed by the server.`, 'success');
        if (mode === 'driver' && (next === TripStatus.COMPLETED || next === TripStatus.CANCELLED)) {
          // A terminal trip never accepts fixes again: stop sharing so the
          // status badge and the OS notification both go quiet honestly.
          void getGpsTracker()
            .stop()
            .catch(() => undefined);
        }
      }
      return ok;
    },
    [setStatus, toast, mode],
  );

  const mapStops: MapStop[] = routeStops
    .filter((stop) => stop.latitude !== null && stop.longitude !== null)
    .map((stop) => ({
      id: stop.id,
      name: stop.name,
      sequence: stop.sequence_number,
      latitude: stop.latitude as number,
      longitude: stop.longitude as number,
    }));

  if (loading && !trip) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Loading the trip…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <ConnectionBanner
        socketReconnecting={live.connection === 'reconnecting' && network !== 'offline'}
      />
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

      <Card
        title={route ? route.name : 'Route'}
        description={
          bus
            ? `${bus.bus_number ? `Bus ${bus.bus_number} · ` : ''}${bus.registration_number} · seats ${bus.capacity}`
            : 'No bus assigned'
        }
        right={
          trip ? (
            <StatusBadge
              tone={tripStatusTone(trip.status)}
              label={TRIP_STATUS_LABELS[trip.status]}
            />
          ) : null
        }
      >
        {trip ? (
          <Text style={styles.times}>
            Scheduled {formatDateTime(trip.scheduled_start_at)}
            {trip.actual_start_at ? ` · departed ${formatDateTime(trip.actual_start_at)}` : ''}
            {trip.actual_end_at ? ` · finished ${formatDateTime(trip.actual_end_at)}` : ''}
          </Text>
        ) : null}
        <View style={styles.liveRow}>
          <Text style={styles.liveText}>{formatFixLine(live.fix)}</Text>
          <StatusBadge
            compact
            tone={live.fix ? 'success' : live.noLocationYet ? 'warning' : 'neutral'}
            label={
              live.fix
                ? `POSITION ${live.fix.received_at.slice(11, 16)} UTC`
                : live.noLocationYet
                  ? 'AWAITING FIRST GPS FIX'
                  : 'NO LIVE POSITION'
            }
          />
        </View>
      </Card>

      {(mode === 'driver' || allowedNextStatuses.length > 0) && trip ? (
        <Card
          title="Trip lifecycle"
          description="Each change is applied and re-validated by the API."
        >
          {mode === 'driver' ? (
            <TripStatusControls
              status={trip.status}
              allowed={allowedNextStatuses}
              disabled={network === 'offline'}
              onTransition={handleTransition}
            />
          ) : (
            <Text style={styles.readOnlyNote}>
              Trip status is managed by the driver (or the school admin). You can run boarding and
              drop-off from this screen.
            </Text>
          )}
        </Card>
      ) : null}

      {mode === 'driver' && trip ? (
        <GpsPanel tripId={trip.id} tripOpen={workspace.isTripOpen} />
      ) : null}

      <StopProgressPanel progress={progress} live={live} />

      <Card
        title="Route map"
        description="Visualisation of server coordinates — routing/ETA stay on the backend."
      >
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
          height={240}
          caption="Auto-fit view · +/− to zoom"
        />
        <MapLegend />
      </Card>

      <Card
        title={`Manifest (${manifest?.items.length ?? 0})`}
        description="Grouped by boarding stop in route order."
      >
        <ManifestPanel
          manifest={manifest}
          tripStatus={trip?.status ?? null}
          canRecord={canOperate}
          busyStudentId={busyStudentId}
          onAction={actOnStudent}
        />
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  times: {
    fontSize: 12,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  liveText: {
    flex: 1,
    fontSize: 12,
    color: colors.neutral[500],
  },
  readOnlyNote: {
    fontSize: 13,
    color: colors.neutral[600],
    lineHeight: 19,
  },
});
