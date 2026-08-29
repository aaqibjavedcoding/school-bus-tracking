import { useCallback } from 'react';
import { getGlobalSession } from '../../auth/global-session';
import { useLoad } from '../../hooks/use-load';
import { todayUtcDate } from '../../utils/format';

/**
 * Parent home (Task 23 §G): children, today's trip and unread notifications.
 * Everything comes from the existing Parent Portal endpoints (`/parent/*`),
 * which derive the parent identity + tenant from the verified JWT — the app
 * never sends parent ids, school ids or roles.
 */
export function useParentHome() {
  const api = getGlobalSession().apiClient;

  const load = useLoad(async () => {
    const [dashboard, unread, tripsToday] = await Promise.all([
      api.getParentDashboard(),
      api.listParentNotifications({ limit: 1 }),
      api.listTrips({ date: todayUtcDate(), limit: 20 }),
    ]);
    return {
      parent: dashboard.data?.parent ?? null,
      school: dashboard.data?.school ?? null,
      children: dashboard.data?.children ?? [],
      unread: unread.data?.unread_count ?? 0,
      /** Server-scoped list: for a PARENT this is only trips on routes with one of their children. */
      tripsToday: tripsToday.data?.items ?? [],
    };
  }, []);

  const refresh = useCallback(() => load.refresh(), [load]);

  return {
    data: load.data,
    loading: load.loading,
    refreshing: load.refreshing,
    error: load.error,
    refresh,
  };
}
