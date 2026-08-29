import { useCallback, useState } from 'react';
import {
  NotificationReadFilter,
  type NotificationRealtimeEvent,
  type NotificationResponse,
} from '@school-bus-tracking/shared-types';
import { getGlobalSession } from '../../auth/global-session';
import { useLoad } from '../../hooks/use-load';
import { useNotificationStream } from '../../socket/use-notifications';

/**
 * Parent notifications (Task 23 §G reusing Task 21): list, unread count,
 * mark one / mark all — all through the existing `/parent/notifications`
 * endpoints. Realtime `notification:new` events (private parent room) prepend
 * onto the open list; there is no second notification system and no client
 * subscription to anything.
 */
export function useParentNotifications(filter: 'all' | NotificationReadFilter = 'all') {
  const api = getGlobalSession().apiClient;
  const status = filter === 'all' ? undefined : filter;
  const [extra, setExtra] = useState<NotificationResponse[]>([]);

  const load = useLoad(async () => {
    const envelope = await api.listParentNotifications({ limit: 50, status });
    return {
      items: envelope.data?.items ?? [],
      total: envelope.data?.total ?? 0,
      unread: envelope.data?.unread_count ?? 0,
    };
  }, [status]);

  const items = mergeNewest([...extra, ...(load.data?.items ?? [])]);

  const markRead = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.markParentNotificationRead(id);
        await load.refresh();
        return true;
      } catch {
        return false;
      }
    },
    [api],
  );

  const markAllRead = useCallback(async (): Promise<number> => {
    try {
      const envelope = await api.markAllParentNotificationsRead();
      setExtra([]);
      await load.refresh();
      return envelope.data?.updated_count ?? 0;
    } catch {
      return -1;
    }
  }, [api]);

  useNotificationStream((event: NotificationRealtimeEvent) => {
    setExtra((prev) => [
      ...prev,
      {
        id: event.notification_id,
        school_id: '',
        user_id: '',
        type: event.type,
        trip_id: event.trip_id,
        student_id: event.student_id,
        stop_id: event.stop_id ?? null,
        title: event.title,
        message: event.message,
        payload: null,
        is_read: false,
        created_at: event.created_at,
        read_at: null,
      },
    ]);
  });

  return {
    items,
    total: load.data?.total ?? 0,
    unread: (load.data?.unread ?? 0) + extra.length,
    loading: load.loading,
    refreshing: load.refreshing,
    error: load.error,
    refresh: load.refresh,
    markRead,
    markAllRead,
  };
}

function mergeNewest(items: NotificationResponse[]): NotificationResponse[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
