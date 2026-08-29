'use client';

import React from 'react';
import { NotificationType, type NotificationResponse } from '@school-bus-tracking/shared-types';
import { formatDateTime } from '../../lib/format';

/** Emoji + human label per notification type (parent-facing copy). */
export function notificationIcon(type: NotificationType): string {
  switch (type) {
    case NotificationType.STUDENT_BOARDED:
      return '🚌';
    case NotificationType.STUDENT_DROPPED:
      return '🏫';
    case NotificationType.TRIP_BOARDING:
      return '🚏';
    case NotificationType.TRIP_IN_PROGRESS:
      return '🚌';
    case NotificationType.TRIP_COMPLETED:
      return '🏁';
    case NotificationType.TRIP_CANCELLED:
      return '⚠️';
    default:
      return '🔔';
  }
}

/** "Today, 7:32 AM" style timestamp for the notification list. */
export function formatNotificationTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (isSameDay(date, today)) return `Today, ${time}`;

  const yesterday = new Date(today.getTime() - 86_400_000);
  if (isSameDay(date, yesterday)) return `Yesterday, ${time}`;

  return formatDateTime(value);
}

/**
 * One notification row. Unread rows are visually emphasized and clicking a
 * student-scoped row navigates to the child's page (trip-scoped rows go to
 * the tracking page).
 */
export const NotificationItem: React.FC<{
  notification: NotificationResponse;
  onOpen?: (notification: NotificationResponse) => void;
}> = ({ notification, onOpen }) => {
  const unread = !notification.is_read;
  return (
    <button
      type="button"
      className={`notification-item ${unread ? 'unread' : ''}`.trim()}
      onClick={() => onOpen?.(notification)}
      aria-label={`${notification.title}: ${notification.message}`}
    >
      <span className="notification-icon" aria-hidden="true">
        {notificationIcon(notification.type)}
      </span>
      <span className="notification-body">
        <span className="notification-title">
          {notification.title}
          {unread ? <span className="notification-dot" aria-label="unread" /> : null}
        </span>
        <span className="notification-message">{notification.message}</span>
        <span className="notification-time muted">
          {formatNotificationTime(notification.created_at)}
        </span>
      </span>
    </button>
  );
};
