import { useMemo } from 'react';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { getGlobalSession } from '../../auth/global-session';
import { useLoad } from '../../hooks/use-load';
import { todayUtcDate } from '../../utils/format';

/**
 * "Today's trip" for crew. The `GET /trips` endpoint pins DRIVER/CONDUCTOR
 * callers to their own dispatch rows server-side (see `TripsService
 * .findAllForActor`), so the app never sends a user id, role or school id —
 * the list is already scoped by the verified token.
 */
export interface CrewToday {
  trips: TripResponse[];
  current: TripResponse | null;
  next: TripResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  todayLabel: string;
}

export function useCrewToday(): CrewToday {
  const api = getGlobalSession().apiClient;
  const today = todayUtcDate();

  const load = useLoad(async () => {
    const envelope = await api.listTrips({ date: today, limit: 50 });
    return envelope.data?.items ?? [];
  }, [today]);

  const { current, next } = useMemo(() => {
    const items = (load.data ?? [])
      .slice()
      .sort((a, b) => a.scheduled_start_at.localeCompare(b.scheduled_start_at));
    const now = Date.now();
    const running =
      items.find((t) => t.status === TripStatus.IN_PROGRESS) ??
      items.find((t) => t.status === TripStatus.BOARDING) ??
      null;
    const upcoming =
      items.find(
        (t) =>
          t.status === TripStatus.SCHEDULED &&
          new Date(t.scheduled_start_at).getTime() >= now - 2 * 3_600_000,
      ) ?? null;
    return { current: running, next: upcoming };
  }, [load.data]);

  return {
    trips: load.data ?? [],
    current,
    next,
    loading: load.loading,
    refreshing: load.refreshing,
    error: load.error,
    refresh: load.refresh,
    todayLabel: today,
  };
}
