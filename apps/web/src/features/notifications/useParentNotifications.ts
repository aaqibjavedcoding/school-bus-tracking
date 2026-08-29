'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationResponse } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { getNotificationsSocket } from '../../services/notifications-socket';

/**
 * Parent notification state (Task 21).
 *
 * Loads the authenticated parent's recent notifications plus the unread
 * count, then keeps both in sync live: every `notification:new` pushed over
 * the `/notifications` socket increments the unread count, prepends the item
 * and (optionally) raises a toast — no page refresh required. Offline
 * parents simply see the persisted rows on the next load.
 */
export function useParentNotifications(options: { recentLimit?: number } = {}) {
  const recentLimit = options.recentLimit ?? 8;
  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<NotificationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const onNewRef = useRef<((notification: NotificationResponse) => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const envelope = await apiClient.listParentNotifications({ limit: recentLimit });
      if (envelope.data) {
        setRecent(envelope.data.items);
        setUnreadCount(envelope.data.unread_count);
      }
    } finally {
      setLoading(false);
    }
  }, [recentLimit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates over the notifications namespace. The socket is shared
  // process-wide; each hook instance manages only its own listeners.
  useEffect(() => {
    const socket = getNotificationsSocket();

    const onNew = (payload: unknown) => {
      const event = payload as {
        notification_id: string;
        type: NotificationResponse['type'];
        title: string;
        message: string;
        student_id: string | null;
        trip_id: string | null;
        stop_id: string | null;
        created_at: string;
      };
      if (!event?.notification_id) return;
      const item: NotificationResponse = {
        id: event.notification_id,
        school_id: '',
        user_id: '',
        type: event.type,
        trip_id: event.trip_id,
        student_id: event.student_id,
        stop_id: event.stop_id,
        title: event.title,
        message: event.message,
        payload: null,
        is_read: false,
        created_at: event.created_at,
        read_at: null,
      };
      setUnreadCount((count) => count + 1);
      setRecent((items) =>
        [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, recentLimit),
      );
      onNewRef.current?.(item);
    };
    const onConnect = () => {
      setConnected(true);
      // Re-sync after a reconnect so nothing missed while offline is lost.
      void refresh();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('notification:new', onNew);
    if (!socket.connected) socket.connect();
    else setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('notification:new', onNew);
    };
  }, [recentLimit, refresh]);

  const markRead = useCallback(async (id: string) => {
    const envelope = await apiClient.markParentNotificationRead(id);
    if (envelope.data?.is_read) {
      setUnreadCount((count) => Math.max(0, count - 1));
      setRecent((items) =>
        items.map((item) =>
          item.id === id && !item.is_read
            ? { ...item, is_read: true, read_at: envelope.data?.read_at ?? null }
            : item,
        ),
      );
    }
    return envelope.data ?? null;
  }, []);

  const markAllRead = useCallback(async () => {
    const envelope = await apiClient.markAllParentNotificationsRead();
    setUnreadCount(0);
    setRecent((items) =>
      items.map((item) =>
        item.is_read ? item : { ...item, is_read: true, read_at: new Date().toISOString() },
      ),
    );
    return envelope.data?.updated_count ?? 0;
  }, []);

  const onNew = useCallback((handler: (notification: NotificationResponse) => void) => {
    onNewRef.current = handler;
  }, []);

  return { unreadCount, recent, loading, connected, refresh, markRead, markAllRead, onNew };
}
