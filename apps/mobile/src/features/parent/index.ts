/**
 * Parent feature — read-only portal surfaces (`/parent/*` REST + realtime
 * notifications), built on the same endpoints the web parent pages use.
 */
export { NotificationsProvider, useParentNotifications } from './NotificationsProvider';
export {
  applyAllNotificationsRead,
  applyNotificationEvent,
  applyNotificationsLoaded,
  applyNotificationRead,
  initialNotificationsState,
  notificationTypeLabel,
  realtimeEventToNotification,
} from './notifications-state';
export type { NotificationsState } from './notifications-state';
