import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  NotificationType,
  type NotificationRealtimeEvent,
  type NotificationResponse,
  type ParentNotificationListResponse,
} from '@school-bus-tracking/shared-types';
import {
  applyAllNotificationsRead,
  applyNotificationEvent,
  applyNotificationsLoaded,
  applyNotificationRead,
  initialNotificationsState,
  notificationTypeLabel,
  realtimeEventToNotification,
} from './notifications-state.ts';

/**
 * Notification-centre state machine: the unread badge and the recent list
 * may only move on API responses and real `notification:new` pushes — never
 * on client-side guesses.
 */
const row = (id: string, isRead: boolean): NotificationResponse => ({
  id,
  school_id: 's',
  user_id: 'u',
  type: NotificationType.STUDENT_BOARDED,
  trip_id: null,
  student_id: null,
  stop_id: null,
  title: `Title ${id}`,
  message: `Message ${id}`,
  payload: null,
  is_read: isRead,
  created_at: '2026-08-29T08:00:00.000Z',
  read_at: isRead ? '2026-08-29T09:00:00.000Z' : null,
});

const push = (id: string): NotificationRealtimeEvent => ({
  notification_id: id,
  type: NotificationType.STOP_ARRIVED,
  title: 'Bus at stop',
  message: 'The bus reached Main St',
  student_id: null,
  trip_id: null,
  stop_id: null,
  created_at: '2026-08-29T10:00:00.000Z',
});

describe('applyNotificationsLoaded', () => {
  it('adopts the server snapshot including the unread count', () => {
    const payload: ParentNotificationListResponse = {
      items: [row('a', false), row('b', true)],
      total: 2,
      unread_count: 1,
    };
    const state = applyNotificationsLoaded(initialNotificationsState, payload);
    assert.equal(state.recent.length, 2);
    assert.equal(state.unreadCount, 1);
    assert.equal(state.total, 2);
  });
});

describe('applyNotificationEvent', () => {
  it('prepends a push and bumps the unread badge', () => {
    const loaded = applyNotificationsLoaded(initialNotificationsState, {
      items: [row('a', true)],
      total: 1,
      unread_count: 0,
    });
    const state = applyNotificationEvent(loaded, push('x'));
    assert.equal(state.recent[0]!.id, 'x');
    assert.equal(state.unreadCount, 1);
    assert.equal(state.total, 2);
  });

  it('ignores a duplicate push (idempotent)', () => {
    const once = applyNotificationEvent(initialNotificationsState, push('x'));
    const twice = applyNotificationEvent(once, push('x'));
    assert.deepEqual(twice, once);
  });

  it('maps the realtime payload onto the REST row shape', () => {
    const item = realtimeEventToNotification(push('x'));
    assert.equal(item.id, 'x');
    assert.equal(item.is_read, false);
    assert.equal(item.type, NotificationType.STOP_ARRIVED);
  });
});

describe('applyNotificationRead / applyAllNotificationsRead', () => {
  it('marks one row read exactly once', () => {
    let state = applyNotificationsLoaded(initialNotificationsState, {
      items: [row('a', false), row('b', false)],
      total: 2,
      unread_count: 2,
    });
    state = applyNotificationRead(state, 'a');
    assert.equal(state.unreadCount, 1);
    state = applyNotificationRead(state, 'a'); // already read — no double decrement
    assert.equal(state.unreadCount, 1);
    state = applyNotificationRead(state, 'missing');
    assert.equal(state.unreadCount, 1);
    assert.equal(state.recent.find((item) => item.id === 'a')!.is_read, true);
  });

  it('marks everything read only for the count the server reported', () => {
    let state = applyNotificationsLoaded(initialNotificationsState, {
      items: [row('a', false), row('b', true)],
      total: 2,
      unread_count: 1,
    });
    state = applyAllNotificationsRead(state, 1);
    assert.equal(state.unreadCount, 0);
    assert.equal(
      state.recent.every((item) => item.is_read),
      true,
    );

    const unchanged = applyAllNotificationsRead(state, 0);
    assert.equal(unchanged, state); // no-op keeps the same reference
  });
});

describe('notificationTypeLabel', () => {
  it('labels every notification kind', () => {
    assert.equal(notificationTypeLabel(NotificationType.STUDENT_BOARDED), '🚌 Boarded');
    assert.equal(notificationTypeLabel(NotificationType.STOP_ARRIVED), '📍 Bus at stop');
    assert.equal(notificationTypeLabel(NotificationType.TRIP_CANCELLED), '⚠️ Trip cancelled');
  });
});
