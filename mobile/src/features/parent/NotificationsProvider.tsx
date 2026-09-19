import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  NOTIFICATION_EVENTS,
  type NotificationRealtimeEvent,
} from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { getNotificationsSocket } from '../../services/notifications-socket';
import { connectAuthenticatedSocket } from '../../services/socket-auth';
import {
  claimNotificationPresentation,
  setPresentationAccount,
} from '../notifications/presentation-dedup';
import {
  applyAllNotificationsRead,
  applyNotificationEvent,
  applyNotificationRead,
  applyNotificationsLoaded,
  initialNotificationsState,
  type NotificationsState,
} from './notifications-state';

/**
 * Parent notification centre provider (mounted only for an authenticated
 * PARENT).
 *
 * Loads the persisted notifications + unread count once, then keeps both in
 * sync live through the existing `/notifications` Socket.IO namespace: the
 * server places the authenticated parent socket into its own private room
 * and pushes `notification:new`. Mark-read calls go through the existing
 * REST endpoints and only then update local state.
 */
interface NotificationsContextValue {
  state: NotificationsState;
  /** True only during the initial load — the blocking skeleton state. */
  loading: boolean;
  /** True only while a user-initiated pull-to-refresh is in flight. */
  refreshing: boolean;
  connected: boolean;
  /** The newest push, surfaced as an in-app banner (dismissable). */
  latestEvent: NotificationRealtimeEvent | null;
  dismissLatest: () => void;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export interface NotificationsProviderProps {
  children: React.ReactNode;
  /**
   * The signed-in parent. Presentation de-duplication is scoped to this
   * account/tenant and cleared whenever it changes, so one account's ids can
   * never suppress another's notifications.
   */
  account: { userId: string; schoolId: string | null };
}

export const NotificationsProvider: React.FC<NotificationsProviderProps> = ({
  children,
  account,
}) => {
  const [state, setState] = useState<NotificationsState>(initialNotificationsState);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [latestEvent, setLatestEvent] = useState<NotificationRealtimeEvent | null>(null);

  const runLoad = useCallback(async (signal: 'loading' | 'refreshing') => {
    const setFlag = signal === 'loading' ? setLoading : setRefreshing;
    setFlag(true);
    try {
      const envelope = await apiClient.listParentNotifications({ page: 1, limit: 30 });
      const payload = envelope.data;
      if (payload) {
        setState((current) => applyNotificationsLoaded(current, payload));
      }
    } catch {
      // Offline parents simply keep the previous snapshot; pull-to-refresh
      // on the notifications screen retries.
    } finally {
      setFlag(false);
    }
  }, []);

  /** Pull-to-refresh: only the pull indicator reports progress. */
  const refresh = useCallback(async () => {
    await runLoad('refreshing');
  }, [runLoad]);

  useEffect(() => {
    void runLoad('loading');
  }, [runLoad]);

  // Bind (and re-bind) the presentation de-dup store to this account.
  useEffect(() => {
    setPresentationAccount({ userId: account.userId, schoolId: account.schoolId ?? null });
  }, [account.userId, account.schoolId]);

  useEffect(() => {
    const socket = getNotificationsSocket();

    const onNew = (payload: unknown) => {
      const event = payload as NotificationRealtimeEvent | null;
      if (!event || typeof event.notification_id !== 'string') {
        return;
      }
      // The inbox and the unread badge are always updated — de-duplication is
      // about *presentation*, never about persistence.
      setState((current) => applyNotificationEvent(current, event));
      // The same logical notification can also arrive as an FCM/APNs push whose
      // foreground handler shows its own banner and plays its own sound. One
      // claim per notification id, across both rails, first arrival wins.
      if (claimNotificationPresentation(event.notification_id, { channel: 'socket' })) {
        setLatestEvent(event);
      }
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on(NOTIFICATION_EVENTS.new, onNew);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) {
      setConnected(true);
    } else {
      connectAuthenticatedSocket(socket);
    }

    return () => {
      socket.off(NOTIFICATION_EVENTS.new, onNew);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  const markRead = useCallback(async (id: string) => {
    try {
      await apiClient.markParentNotificationRead(id);
      setState((current) => applyNotificationRead(current, id));
    } catch {
      // The unread badge only moves after the server accepted the change.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      const envelope = await apiClient.markAllParentNotificationsRead();
      const updated = envelope.data?.updated_count ?? 0;
      setState((current) => applyAllNotificationsRead(current, updated));
    } catch {
      // See markRead.
    }
  }, []);

  const dismissLatest = useCallback(() => setLatestEvent(null), []);

  const value = useMemo(
    () => ({
      state,
      loading,
      refreshing,
      connected,
      latestEvent,
      dismissLatest,
      refresh,
      markRead,
      markAllRead,
    }),
    [state, loading, refreshing, connected, latestEvent, dismissLatest, refresh, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export function useParentNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error('useParentNotifications must be used within NotificationsProvider');
  }
  return value;
}
