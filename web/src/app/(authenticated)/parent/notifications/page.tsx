'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import {
  NotificationReadFilter,
  type NotificationResponse,
} from '@school-bus-tracking/shared-types';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import { apiClient } from '../../../../services/api';
import { useParentNotifications } from '../../../../features/notifications/useParentNotifications';
import { NotificationItem } from '../../../../features/notifications/NotificationList';

type StatusFilter = 'all' | NotificationReadFilter;

const PAGE_SIZE = 20;

/**
 * Parent notification history (`/parent/notifications`).
 *
 * Everything shown comes from `GET /api/v1/parent/notifications`, scoped to
 * the JWT on the server. Items load with `status` filters and pagination;
 * clicking marks the item read and navigates to the child/trip it is about.
 * New arrivals land over the `/notifications` socket and refresh the list
 * without a page reload.
 */
export default function ParentNotificationsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>('all');

  const { data, loading, error, reload } = useLoad(async () => {
    const envelope = await apiClient.listParentNotifications({
      page,
      limit: PAGE_SIZE,
      ...(status === 'all' ? {} : { status }),
    });
    if (!envelope.data) {
      throw new Error(
        envelope.error?.message || envelope.message || 'Could not load notifications',
      );
    }
    return envelope.data;
  }, [page, status]);

  // Live unread count + auto-refresh on new arrivals (shares the
  // process-wide socket with the bell).
  const { unreadCount, markRead, markAllRead, onNew } = useParentNotifications({
    recentLimit: 1,
  });

  useEffect(() => {
    onNew(() => {
      void reload();
    });
  }, [onNew, reload]);

  const openNotification = async (notification: NotificationResponse) => {
    if (!notification.is_read) {
      try {
        await markRead(notification.id);
      } catch {
        // Best-effort; navigation still happens.
      }
    }
    if (notification.student_id) {
      router.push(`/parent/children/${notification.student_id}`);
    } else if (notification.trip_id) {
      router.push('/parent/tracking');
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="page">
      <PageHeader
        title="Notifications"
        description={
          unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.`
            : 'You are all caught up.'
        }
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void markAllRead().then(() => reload())}
            disabled={unreadCount === 0}
          >
            Mark all read
          </button>
        }
      />

      <Card>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {(['all', 'unread', 'read'] as StatusFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn btn-small ${status === value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setPage(1);
                setStatus(value);
              }}
            >
              {value === 'all' ? 'All' : value === 'unread' ? 'Unread' : 'Read'}
            </button>
          ))}
        </div>
      </Card>

      {loading && !data ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : error || !data ? (
        <Card>
          <ErrorState
            message={error ?? 'Could not load your notifications'}
            onRetry={() => void reload()}
          />
        </Card>
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing here yet"
            description="Notifications about your child's trips will appear here as they happen."
          />
        </Card>
      ) : (
        <Card>
          <div className="notification-list">
            {data.items.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onOpen={(item) => void openNotification(item)}
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="pagination">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </button>
              <span className="muted">
                Page {page} of {totalPages} · {data.total} total
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
