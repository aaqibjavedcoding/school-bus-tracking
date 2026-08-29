import { useCallback, useMemo, useState } from 'react';
import {
  NotificationReadFilter,
  TripStatus,
  type BusResponse,
  type ConductorResponse,
  type DriverResponse,
  type ParentResponse,
  type RouteAssignmentResponse,
  type RouteResponse,
  type StudentResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { getGlobalSession } from '../../auth/global-session';
import { useLoad } from '../../hooks/use-load';
import { todayUtcDate } from '../../utils/format';

/**
 * Thin, screen-sized data hooks for the Admin app. They add no business
 * logic: every one is a call to the existing tenant-scoped endpoints (the API
 * derives the school from the bearer token) plus local list plumbing
 * (search, paging-by-limit, pull-to-refresh).
 */

export function useAdminDashboard() {
  const api = getGlobalSession().apiClient;

  return useLoad(async () => {
    const today = todayUtcDate();
    const [students, buses, drivers, conductors, trips] = await Promise.all([
      api.listStudents({ limit: 1 }),
      api.listBuses({ limit: 1 }),
      api.listDrivers({ limit: 1 }),
      api.listConductors({ limit: 1 }),
      api.listTrips({ date: today, limit: 100 }),
    ]);

    const items = trips.data?.items ?? [];
    const countBy = (status: TripStatus): number => items.filter((t) => t.status === status).length;

    return {
      totalStudents: students.data?.meta.total ?? 0,
      totalBuses: buses.data?.meta.total ?? 0,
      totalDrivers: drivers.data?.meta.total ?? 0,
      totalConductors: conductors.data?.meta.total ?? 0,
      tripsToday: items.length,
      activeToday: countBy(TripStatus.IN_PROGRESS) + countBy(TripStatus.BOARDING),
      completedToday: countBy(TripStatus.COMPLETED),
      cancelledToday: countBy(TripStatus.CANCELLED),
      scheduledToday: countBy(TripStatus.SCHEDULED),
      today,
    };
  }, []);
}

export interface PagedSearch<T> {
  items: T[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  setSearch: (value: string) => void;
  search: string;
  refresh: () => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  savedTick: number;
  bumpSaved: () => void;
}

export function usePagedSearch<T>(
  fetcher: (search: string) => Promise<T[]>,
  deleter?: (id: string) => Promise<unknown>,
): PagedSearch<T> {
  const [search, setSearchState] = useState('');
  const [savedTick, setSavedTick] = useState(0);
  const load = useLoad(() => fetcher(search), [search, savedTick]);

  const setSearch = useCallback((value: string) => {
    setSearchState(value.trim());
  }, []);

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (!deleter) {
        return false;
      }
      try {
        await deleter(id);
        setSavedTick((t) => t + 1);
        return true;
      } catch {
        return false;
      }
    },
    [deleter],
  );

  const bumpSaved = useCallback(() => setSavedTick((t) => t + 1), []);

  return {
    items: load.data ?? [],
    loading: load.loading,
    refreshing: load.refreshing,
    error: load.error,
    search,
    setSearch,
    refresh: load.refresh,
    remove,
    savedTick,
    bumpSaved,
  };
}

/** Students. */
export function useStudents() {
  const api = getGlobalSession().apiClient;
  return usePagedSearch<StudentResponse>(
    useCallback(
      async (search: string) =>
        (await api.listStudents({ limit: 50, search: search || undefined })).data?.items ?? [],
      [api],
    ),
    useCallback((id: string) => api.deleteStudent(id), [api]),
  );
}

export function useStudent(id: string) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    const envelope = await api.getStudent(id);
    return envelope.data ?? null;
  }, [id]);
}

/** Parents (guardian accounts managed by the school). */
export function useParents() {
  const api = getGlobalSession().apiClient;
  return usePagedSearch<ParentResponse>(
    useCallback(
      async (search: string) =>
        (await api.listParents({ limit: 50, search: search || undefined })).data?.items ?? [],
      [api],
    ),
    useCallback((id: string) => api.deleteParent(id), [api]),
  );
}

export function useParentChildren(parentId: string | null) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    if (!parentId) return [];
    const envelope = await api.listParentStudents(parentId);
    return envelope.data?.items ?? [];
  }, [parentId]);
}

/** Drivers & conductors. */
export function useDrivers() {
  const api = getGlobalSession().apiClient;
  return usePagedSearch<DriverResponse>(
    useCallback(
      async (search: string) =>
        (await api.listDrivers({ limit: 50, search: search || undefined })).data?.items ?? [],
      [api],
    ),
    useCallback((id: string) => api.deleteDriver(id), [api]),
  );
}

export function useConductors() {
  const api = getGlobalSession().apiClient;
  return usePagedSearch<ConductorResponse>(
    useCallback(
      async (search: string) =>
        (await api.listConductors({ limit: 50, search: search || undefined })).data?.items ?? [],
      [api],
    ),
    useCallback((id: string) => api.deleteConductor(id), [api]),
  );
}

export function useStaffMember(kind: 'driver' | 'conductor', id: string) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    const envelope = kind === 'driver' ? await api.getDriver(id) : await api.getConductor(id);
    return envelope.data ?? null;
  }, [kind, id]);
}

/** Buses. */
export function useBuses() {
  const api = getGlobalSession().apiClient;
  return usePagedSearch<BusResponse>(
    useCallback(
      async (search: string) =>
        (await api.listBuses({ limit: 50, search: search || undefined })).data?.items ?? [],
      [api],
    ),
    useCallback((id: string) => api.deleteBus(id), [api]),
  );
}

export function useBus(id: string) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => (await api.getBus(id)).data ?? null, [id]);
}

/** Routes + stops. */
export function useRoutes() {
  const api = getGlobalSession().apiClient;
  return usePagedSearch<RouteResponse>(
    useCallback(
      async (search: string) =>
        (await api.listRoutes({ limit: 50, search: search || undefined })).data?.items ?? [],
      [api],
    ),
    useCallback((id: string) => api.deleteRoute(id), [api]),
  );
}

export function useRouteDetail(id: string) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    const routeEnvelope = await api.getRoute(id);
    const stopsEnvelope = await api.listRouteStops(id).catch(() => null);
    return {
      route: routeEnvelope.data ?? null,
      stops: stopsEnvelope?.data?.items ?? [],
    };
  }, [id]);
}

export function useRouteStops(routeId: string) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => (await api.listRouteStops(routeId)).data?.items ?? [], [routeId]);
}

/** Assignments. */
export function useAssignments() {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    const envelope = await api.listAssignments({ limit: 50 });
    const items = envelope.data?.items ?? [];
    // Enrich rows for display — batched lookups, failures are non-fatal.
    const [routes, buses, drivers, conductors] = await Promise.all([
      api.listRoutes({ limit: 100 }).catch(() => null),
      api.listBuses({ limit: 100 }).catch(() => null),
      api.listDrivers({ limit: 100 }).catch(() => null),
      api.listConductors({ limit: 100 }).catch(() => null),
    ]);
    const routeName = new Map((routes?.data?.items ?? []).map((r) => [r.id, r.name]));
    const busLabel = new Map(
      (buses?.data?.items ?? []).map((b) => [
        b.id,
        b.bus_number ? `${b.bus_number} (${b.registration_number})` : b.registration_number,
      ]),
    );
    const userName = new Map<string, string>([
      ...(drivers?.data?.items ?? []).map(
        (d) => [d.id, `${d.first_name} ${d.last_name}`] as [string, string],
      ),
      ...(conductors?.data?.items ?? []).map(
        (c) => [c.id, `${c.first_name} ${c.last_name}`] as [string, string],
      ),
    ]);
    return {
      items,
      routeName,
      busLabel,
      userName,
    };
  }, []);
}

export type AssignmentRow = {
  assignment: RouteAssignmentResponse;
  routeLabel: string;
  busLabel: string;
  personLabel: string;
};

export function useAssignmentRows() {
  const { data, ...rest } = useAssignments();
  const rows = useMemo<AssignmentRow[]>(() => {
    if (!data) {
      return [];
    }
    return data.items.map((assignment) => ({
      assignment,
      routeLabel: data.routeName.get(assignment.route_id) ?? 'Route',
      busLabel: assignment.bus_id ? (data.busLabel.get(assignment.bus_id) ?? 'Bus') : 'No bus',
      personLabel: data.userName.get(assignment.user_id) ?? 'Unknown',
    }));
  }, [data]);
  return { rows, ...rest };
}

/** Trips. */
export function useTrips(scope: 'today' | 'upcoming') {
  const api = getGlobalSession().apiClient;
  const today = todayUtcDate();
  return useLoad(async () => {
    const envelope =
      scope === 'today'
        ? await api.listTrips({ date: today, limit: 50 })
        : await api.listTrips({ date_from: tomorrowFrom(today), limit: 50 });
    return (envelope.data?.items ?? [])
      .slice()
      .sort((a, b) => a.scheduled_start_at.localeCompare(b.scheduled_start_at));
  }, [scope, today]);
}

export function useActiveTripsForMonitoring() {
  const api = getGlobalSession().apiClient;
  const today = todayUtcDate();
  return useLoad(async () => {
    const envelope = await api.listTrips({ date: today, limit: 100 });
    const items = envelope.data?.items ?? [];
    return items.filter(
      (trip) => trip.status !== TripStatus.COMPLETED && trip.status !== TripStatus.CANCELLED,
    );
  }, [today]);
}

export function useStopOptionsForStudentHomeStop(search: string) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    const envelope = await api.listStops({ limit: 100, search: search || undefined });
    return envelope.data?.items ?? [];
  }, [search]);
}

export function useGuardians(studentId: string | null) {
  const api = getGlobalSession().apiClient;
  return useLoad(async () => {
    if (!studentId) return [];
    const envelope = await api.listStudentGuardians(studentId);
    const guardians = envelope.data?.items ?? [];
    const parents = await api.listParents({ limit: 100 }).catch(() => null);
    const byId = new Map((parents?.data?.items ?? []).map((p) => [p.id, p]));
    return guardians.map((g) => ({
      ...g,
      parent: byId.get(g.parent_id) ?? null,
    }));
  }, [studentId]);
}

export function tripStatusLabel(trip: TripResponse): string {
  switch (trip.status) {
    case TripStatus.SCHEDULED:
      return 'Scheduled';
    case TripStatus.BOARDING:
      return 'Boarding';
    case TripStatus.IN_PROGRESS:
      return 'In progress';
    case TripStatus.COMPLETED:
      return 'Completed';
    case TripStatus.CANCELLED:
      return 'Cancelled';
    default:
      return trip.status;
  }
}

export const PARENT_NOTIFICATION_FILTERS = NotificationReadFilter;

export function tomorrowFrom(todayUtc: string): string {
  const date = new Date(`${todayUtc}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
