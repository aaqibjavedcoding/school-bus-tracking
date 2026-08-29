import {
  NotificationType,
  type NotificationRealtimeEvent,
  type NotificationResponse,
  type ParentNotificationListResponse,
} from '@school-bus-tracking/shared-types';

/**
 * Pure state transitions for the parent notification centre (unit-tested).
 *
 * The list and the unread count are always derived from the API responses
 * and from `notification:new` pushes over the `/notifications` socket — the
 * client never synthesises a notification of its own.
 */

export interface NotificationsState {
  recent: NotificationResponse[];
  unreadCount: number;
  total: number;
}

export const initialNotificationsState: NotificationsState = {
  recent: [],
  unreadCount: 0,
  total: 0,
};

/** Replaces the snapshot with a fresh `GET /parent/notifications` payload. */
export function applyNotificationsLoaded(
  state: NotificationsState,
  payload: ParentNotificationListResponse,
): NotificationsState {
  return {
    recent: payload.items,
    unreadCount: payload.unread_count,
    total: payload.total,
  };
}

/** Maps a realtime push onto the same row shape the REST list returns. */
export function realtimeEventToNotification(
  event: NotificationRealtimeEvent,
): NotificationResponse {
  return {
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
}

/** Prepends a pushed notification and bumps the unread badge (idempotent). */
export function applyNotificationEvent(
  state: NotificationsState,
  event: NotificationRealtimeEvent,
  limit = 30,
): NotificationsState {
  const item = realtimeEventToNotification(event);
  if (state.recent.some((existing) => existing.id === item.id)) {
    return state;
  }
  return {
    ...state,
    recent: [item, ...state.recent].slice(0, limit),
    unreadCount: state.unreadCount + 1,
    total: state.total + 1,
  };
}

/** Marks one notification read locally after the API confirmed it. */
export function applyNotificationRead(state: NotificationsState, id: string): NotificationsState {
  const target = state.recent.find((item) => item.id === id);
  if (!target || target.is_read) {
    return state;
  }
  return {
    ...state,
    recent: state.recent.map((item) =>
      item.id === id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item,
    ),
    unreadCount: Math.max(0, state.unreadCount - 1),
  };
}

/** Marks everything read after `PATCH /parent/notifications/read-all`. */
export function applyAllNotificationsRead(
  state: NotificationsState,
  updatedCount: number,
): NotificationsState {
  if (updatedCount <= 0) {
    return state;
  }
  return {
    ...state,
    recent: state.recent.map((item) =>
      item.is_read ? item : { ...item, is_read: true, read_at: new Date().toISOString() },
    ),
    unreadCount: 0,
  };
}

/** Icon label for a notification type (used by the list rows). */
export function notificationTypeLabel(type: NotificationType): string {
  switch (type) {
    case NotificationType.STUDENT_BOARDED:
      return '🚌 Boarded';
    case NotificationType.STUDENT_DROPPED:
      return '🏠 Dropped off';
    case NotificationType.TRIP_BOARDING:
      return '⏳ Boarding started';
    case NotificationType.TRIP_IN_PROGRESS:
      return '🛣 Bus departed';
    case NotificationType.TRIP_COMPLETED:
      return '✅ Trip completed';
    case NotificationType.TRIP_CANCELLED:
      return '⚠️ Trip cancelled';
    case NotificationType.STOP_ARRIVED:
      return '📍 Bus at stop';
    default:
      return type;
  }
}
