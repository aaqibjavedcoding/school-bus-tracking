import { useMemo } from 'react';
import type { ParentTrackingResponse } from '@school-bus-tracking/shared-types';
import { getGlobalSession } from '../../auth/global-session';
import { useLoad } from '../../hooks/use-load';
import { useLiveTrip } from '../../socket/use-live-trip';

/**
 * Live child tracking (Task 23 §G): the existing `GET /parent/children/:id/
 * tracking` REST snapshot, then the same `/live-tracking` room for movement —
 * i.e. the identical bus position parents see on the web. The backend decides
 * *whether* this socket may observe the trip (parent-child authorisation);
 * a denied join simply leaves the REST snapshot on screen.
 */
export function useChildTracking(childId: string | null) {
  const api = getGlobalSession().apiClient;

  const load = useLoad<ParentTrackingResponse | null>(async () => {
    if (!childId) {
      return null;
    }
    const envelope = await api.getParentChildTracking(childId);
    return envelope.data ?? null;
  }, [childId]);

  const snapshot = load.data;
  const live = useLiveTrip(snapshot?.trip ? snapshot.trip.id : null);

  const position = useMemo(() => {
    if (live.fix) {
      return {
        latitude: live.fix.latitude,
        longitude: live.fix.longitude,
        heading: live.fix.heading,
        received_at: live.fix.received_at,
        source: 'live' as const,
      };
    }
    if (snapshot?.latest) {
      return {
        latitude: snapshot.latest.latitude,
        longitude: snapshot.latest.longitude,
        heading: snapshot.latest.heading,
        received_at: snapshot.latest.received_at,
        source: 'rest' as const,
      };
    }
    return null;
  }, [live.fix, snapshot?.latest]);

  const eta = live.eta ?? snapshot?.eta ?? null;

  const stops = useMemo(
    () =>
      (snapshot?.stops ?? [])
        .filter((stop) => stop.latitude !== null && stop.longitude !== null)
        .map((stop) => ({
          id: stop.id,
          name: stop.name,
          sequence: stop.sequence_number,
          latitude: stop.latitude as number,
          longitude: stop.longitude as number,
          geofence_radius_meters: stop.geofence_radius_meters,
        })),
    [snapshot?.stops],
  );

  return {
    snapshot,
    live,
    position,
    eta,
    stops,
    loading: load.loading,
    error: load.error,
    refresh: load.refresh,
  };
}
