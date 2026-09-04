import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import { NotificationReadFilter, NotificationType } from '@school-bus-tracking/shared-types';

const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';

describe('ApiClient parent notification methods', () => {
  it('uses the parent-scoped endpoints and never sends a parent or school id', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(
        JSON.stringify({ success: true, data: { items: [], total: 0, unread_count: 0 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.listParentNotifications();
      await client.listParentNotifications({
        page: 2,
        limit: 5,
        status: NotificationReadFilter.UNREAD,
      });
      await client.markParentNotificationRead(NOTIFICATION_ID);
      await client.markAllParentNotificationsRead();

      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        [
          'GET https://api.example.test/api/v1/parent/notifications',
          `GET https://api.example.test/api/v1/parent/notifications?page=2&limit=5&status=${NotificationReadFilter.UNREAD}`,
          `PATCH https://api.example.test/api/v1/parent/notifications/${NOTIFICATION_ID}/read`,
          'PATCH https://api.example.test/api/v1/parent/notifications/read-all',
        ],
      );

      for (const request of requests) {
        assert.ok(!request.url.includes('school_id'));
        assert.ok(!request.url.includes('user_id'));
        assert.ok(!request.url.includes('parent_id'));
        assert.ok(!request.body?.includes('school_id'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('encodes path parameters and unwraps the envelope', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: '22222222-2222-4222-8222-222222222222',
            school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            user_id: '33333333-3333-4333-8333-333333333333',
            type: NotificationType.STUDENT_BOARDED,
            trip_id: null,
            student_id: null,
            title: 'Aarav boarded',
            message: 'Aarav Sharma boarded the school bus.',
            payload: null,
            is_read: true,
            created_at: '2026-09-01T06:31:00.000Z',
            read_at: '2026-09-01T08:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const result = await client.markParentNotificationRead('notification id/1');
      assert.equal(result.data?.type, NotificationType.STUDENT_BOARDED);
      assert.equal(result.data?.is_read, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
