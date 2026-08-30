'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { UserRole } from '@school-bus-tracking/shared-types';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../../components/ui';
import { useParentNotifications } from './useParentNotifications';
import { NotificationItem } from './NotificationList';

/**
 * Notification bell for the top bar (parents only).
 *
 * Shows the live unread count; opening it reveals the most recent
 * notifications. New events arrive over the `/notifications` socket and pop a
 * toast immediately — no refresh. Clicking a notification marks it read and
 * jumps to the relevant child (or tracking page).
 */
export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isParent = user?.role === UserRole.PARENT;

  const { unreadCount, recent, loading, markRead, onNew } = useParentNotifications({
    recentLimit: 8,
    // The bell is parents-only; non-parent roles (e.g. admin/crew) must not
    // hit the parent-scoped notification endpoint, which would return 403.
    enabled: isParent,
  });

  useEffect(() => {
    onNew((notification) => {
      toast.push(`🔔 ${notification.title} — ${notification.message}`);
    });
  }, [onNew, toast]);

  // Close the dropdown on any outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onClickAway = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  if (!isParent) return null;

  const openNotification = async (notification: (typeof recent)[number]) => {
    setOpen(false);
    if (!notification.is_read) {
      try {
        await markRead(notification.id);
      } catch {
        // Reading is best-effort; navigation still happens.
      }
    }
    if (notification.student_id) {
      router.push(`/parent/children/${notification.student_id}`);
    } else if (notification.trip_id) {
      router.push('/parent/tracking');
    }
  };

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className="notification-bell-button"
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="notification-count" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      <span className="sr-only">{`Unread: ${unreadCount}`}</span>

      {open ? (
        <div className="notification-panel" role="dialog" aria-label="Recent notifications">
          <div className="notification-panel-head">
            <strong>Notifications</strong>
            <span className="muted">{unreadCount} unread</span>
          </div>
          <div className="notification-panel-list">
            {loading && recent.length === 0 ? (
              <p className="muted" style={{ padding: '0.75rem' }}>
                Loading…
              </p>
            ) : recent.length === 0 ? (
              <p className="muted" style={{ padding: '0.75rem' }}>
                No notifications yet. You will hear from us when your child's bus moves.
              </p>
            ) : (
              recent.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={(item) => void openNotification(item)}
                />
              ))
            )}
          </div>
          <button
            type="button"
            className="notification-panel-footer"
            onClick={() => {
              setOpen(false);
              router.push('/parent/notifications');
            }}
          >
            View all notifications
          </button>
        </div>
      ) : null}
    </div>
  );
};
