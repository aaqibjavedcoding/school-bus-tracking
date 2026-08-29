import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TripStatus,
  type BusResponse,
  type RouteResponse,
  type StopResponse,
  type TripProgressResponse,
  type TripResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { getGlobalSession } from '../../auth/global-session';
import { useLoad } from '../../hooks/use-load';
import { useLiveTrip } from '../../socket/use-live-trip';
import { useNetworkStatus } from '../../hooks/use-network';
import { useOnAppForeground } from '../../hooks/use-app-state';
import { allowedTransitionsFrom, transitionTrip } from '../shared/trip-lifecycle';
import { performAttendanceAction, mergeAttendanceRow, type AttendanceAction } from './attendance';

/**
 * The shared operational workspace for Driver & Conductor (and, read-only,
 * the Admin trip screen).
 *
 * Everything on screen is server state:
 *
 * - trip / route / bus facts come from `GET /trips/:id`, `/routes/:id`,
 *   `/buses/:id`;
 * - the manifest + progress come from `/trips/:id/students` and
 *   `/trips/:id/progress`;
 * - live position / ETA / arrivals stream from the existing `/live-tracking`
 *   Socket.IO room (the room re-joins itself after every reconnect);
 * - status transitions go through `PATCH /trips/:id/status`; the allowed
 *   buttons are *displayed* from the shared transition table but the backend
 *   still rejects anything illegal (generic 404 for non-crew, 400/409 for bad
 *   states) — mobile does not implement an authoritative state machine.
 */

interface WorkspaceData {
  trip: TripResponse | null;
  route: RouteResponse | null;
  bus: BusResponse | null;
  manifest: TripStudentManifestResponse | null;
  progress: TripProgressResponse | null;
  routeStops: StopResponse[];
}

const emptyData: WorkspaceData = {
  trip: null,
  route: null,
  bus: null,
  manifest: null,
  progress: null,
  routeStops: [],
};

export interface TripWorkspace {
  trip: TripResponse | null;
  route: RouteResponse | null;
  bus: BusResponse | null;
  manifest: TripStudentManifestResponse | null;
  progress: TripProgressResponse | null;
  routeStops: StopResponse[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;

  live: ReturnType<typeof useLiveTrip>;
  network: ReturnType<typeof useNetworkStatus>;

  allowedNextStatuses: TripStatus[];
  isTripOpen: boolean;
  canOperate: boolean;

  /** Resolves true when the server accepted the transition. */
  setStatus: (next: TripStatus, cancellationReason?: string | null) => Promise<boolean>;
  actOnStudent: (studentId: string, action: AttendanceAction) => Promise<void>;
  busyStudentId: string | null;
  lastActionMessage: string | null;
  clearLastActionMessage: () => void;
}

export function useTripWorkspace(
  tripId: string | null,
  options: { canOperate?: boolean } = {},
): TripWorkspace {
  const api = getGlobalSession().apiClient;
  const canOperateFlag = options.canOperate ?? true;
  const network = useNetworkStatus();

  const load = useLoad<WorkspaceData>(async () => {
    if (!tripId) {
      return emptyData;
    }
    const tripEnvelope = await api.getTrip(tripId);
    const loadedTrip = tripEnvelope.data ?? null;
    const [routeEnvelope, busEnvelope, manifestEnvelope, progressEnvelope, stopsEnvelope] =
      await Promise.all([
        loadedTrip?.route_id
          ? api.getRoute(loadedTrip.route_id).catch(() => null)
          : Promise.resolve(null),
        loadedTrip?.bus_id
          ? api.getBus(loadedTrip.bus_id).catch(() => null)
          : Promise.resolve(null),
        api.listTripStudents(tripId).catch(() => null),
        api.getTripProgress(tripId).catch(() => null),
        loadedTrip?.route_id
          ? api.listRouteStops(loadedTrip.route_id).catch(() => null)
          : Promise.resolve(null),
      ]);
    return {
      trip: loadedTrip,
      route: routeEnvelope?.data ?? null,
      bus: busEnvelope?.data ?? null,
      manifest: manifestEnvelope?.data ?? null,
      progress: progressEnvelope?.data ?? null,
      routeStops: stopsEnvelope?.data?.items ?? [],
    };
  }, [tripId]);

  const data = load.data ?? emptyData;
  const live = useLiveTrip(tripId ? tripId : null);

  const patchData = useCallback(
    (patch: Partial<WorkspaceData>): void => {
      load.setData((prev: WorkspaceData | null) => ({ ...(prev ?? emptyData), ...patch }));
    },
    [load.setData],
  );

  // Live ETA/arrivals from the socket take display precedence; the REST
  // progress snapshot is the fallback (e.g. after a denied join on a closed
  // trip where only history exists).
  const progress = useMemo<TripProgressResponse | null>(() => {
    const rest = data.progress;
    if (!live.eta) {
      return rest;
    }
    return {
      trip_id: live.eta.trip_id,
      school_id: live.eta.school_id,
      trip_status: live.eta.trip_status,
      tracking_state: live.eta.tracking_state,
      current_stop: live.eta.current_stop,
      next_stop: live.eta.next_stop,
      arrivals: rest?.arrivals ?? [],
      eta: live.eta,
    };
  }, [data.progress, live.eta]);

  // A server-pushed trip status update (tracking started/stopped events)
  // keeps the header truthful even without a manual refresh.
  const lastSocketStatus = live.tripStatus;
  useEffect(() => {
    if (data.trip && lastSocketStatus && data.trip.status !== lastSocketStatus) {
      patchData({ trip: { ...data.trip, status: lastSocketStatus } });
    }
  }, [data.trip, lastSocketStatus, patchData]);

  const refresh = useCallback(async () => {
    await load.refresh();
  }, [load]);

  useOnAppForeground((state) => {
    if (state === 'active' && tripId) {
      void refresh();
    }
  });

  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);

  const setStatus = useCallback(
    async (next: TripStatus, cancellationReason?: string | null): Promise<boolean> => {
      if (!tripId) {
        return false;
      }
      const result = await transitionTrip(api, tripId, next, cancellationReason ?? null);
      if (result.ok && result.trip) {
        patchData({ trip: result.trip });
        void refresh(); // progress/tracking state changed server-side
        return true;
      }
      setLastActionMessage(result.message ?? 'Trip update failed.');
      if (result.stale) {
        void refresh();
      }
      return false;
    },
    [api, tripId, refresh, patchData],
  );

  const actOnStudent = useCallback(
    async (studentId: string, action: AttendanceAction): Promise<void> => {
      if (!tripId || busyStudentId) {
        return; // guards accidental double-taps while one action is in flight
      }
      setBusyStudentId(studentId);
      try {
        const result = await performAttendanceAction({
          api,
          tripId,
          studentId,
          action,
          online: network !== 'offline',
        });
        if (result.ok && result.row && data.manifest) {
          patchData({ manifest: mergeAttendanceRow(data.manifest, result.row) });
          setLastActionMessage(
            action === 'board'
              ? `${result.row.first_name} ${result.row.last_name} confirmed on board.`
              : `${result.row.first_name} ${result.row.last_name} dropped off.`,
          );
        } else {
          setLastActionMessage(result.message ?? 'Attendance action failed.');
          if (result.kind === 'conflict') {
            void refresh(); // converge on server truth after a 409
          }
        }
      } finally {
        setBusyStudentId(null);
      }
    },
    [api, tripId, busyStudentId, network, data.manifest, refresh, patchData],
  );

  const trip = data.trip;
  const isTripOpen = trip
    ? trip.status === TripStatus.SCHEDULED ||
      trip.status === TripStatus.BOARDING ||
      trip.status === TripStatus.IN_PROGRESS
    : false;

  return {
    trip,
    route: data.route,
    bus: data.bus,
    manifest: data.manifest,
    progress,
    routeStops: data.routeStops ?? [],
    loading: load.loading,
    refreshing: load.refreshing,
    error: load.error,
    refresh,
    live,
    network,
    allowedNextStatuses: trip ? allowedTransitionsFrom(trip.status) : [],
    isTripOpen,
    canOperate: canOperateFlag && isTripOpen,
    setStatus,
    actOnStudent,
    busyStudentId,
    lastActionMessage,
    clearLastActionMessage: () => setLastActionMessage(null),
  };
}
