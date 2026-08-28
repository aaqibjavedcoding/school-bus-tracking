import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient, ApiClientError } from '@school-bus-tracking/api-client';
import { TripStatus } from '@school-bus-tracking/shared-types';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';

interface CapturedRequest {
  url: string;
  method: string;
  init?: RequestInit;
}

function mockFetch(responder: (url: string, init?: RequestInit) => Response) {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET', init });
    return responder(url, init);
  }) as typeof fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ApiClient live-tracking location methods', () => {
  it('reads the latest position from the tenant-free nested endpoint', async () => {
    const { requests, restore } = mockFetch((url, init) => {
      assert.equal(init?.method, 'GET');
      assert.ok(!url.includes('school_id'));
      assert.ok(!url.includes('driver_id'));
      assert.ok(!url.includes('conductor_id'));
      return jsonResponse({
        success: true,
        data: {
          id: '88888888-8888-4888-8888-888888880002',
          school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          trip_id: TRIP_ID,
          latitude: 51.5,
          longitude: -0.1,
          accuracy: 8,
          speed: 24,
          heading: 90,
          recorded_at: '2026-09-01T06:31:00.000Z',
          received_at: '2026-09-01T06:31:00.200Z',
          trip_status: TripStatus.IN_PROGRESS,
          tracking_state: 'active',
        },
      });
    });

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const envelope = await client.getTripLocation(TRIP_ID);

      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        [`GET https://api.example.test/api/v1/trips/${TRIP_ID}/location`],
      );
      assert.equal(envelope.success, true);
      assert.equal(envelope.data?.latitude, 51.5);
      assert.equal(envelope.data?.trip_status, TripStatus.IN_PROGRESS);
      assert.equal(envelope.data?.tracking_state, 'active');
    } finally {
      restore();
    }
  });

  it('lists bounded history with query parameters and a stable key order', async () => {
    const { requests, restore } = mockFetch((url) => {
      assert.ok(!url.includes('school_id'));
      return jsonResponse({
        success: true,
        data: {
          trip_id: TRIP_ID,
          school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          items: [
            {
              id: '88888888-8888-4888-8888-888888880002',
              school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              trip_id: TRIP_ID,
              latitude: 51.5,
              longitude: -0.1,
              accuracy: 10,
              speed: 20,
              heading: 90,
              recorded_at: '2026-09-01T06:31:00.000Z',
              received_at: '2026-09-01T06:31:00.200Z',
            },
          ],
          has_more: false,
        },
      });
    });

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });

      // No filters at all — bare history path, no query string.
      await client.getTripLocationHistory(TRIP_ID);
      assert.equal(
        requests[0].url,
        `https://api.example.test/api/v1/trips/${TRIP_ID}/location/history`,
      );

      // A full window — the order and encoding of the parameters must be
      // deterministic so clients and logs stay comparable.
      await client.getTripLocationHistory(TRIP_ID, {
        from: '2026-09-01T06:00:00.000Z',
        to: '2026-09-01T09:00:00.000Z',
        limit: 500,
      });
      assert.equal(
        requests[1].url,
        `https://api.example.test/api/v1/trips/${TRIP_ID}/location/history` +
          `?from=2026-09-01T06%3A00%3A00.000Z&to=2026-09-01T09%3A00%3A00.000Z&limit=500`,
      );

      // Partial windows keep their key order (from, to, limit).
      await client.getTripLocationHistory(TRIP_ID, { to: '2026-09-01T09:00:00.000Z' });
      assert.equal(
        requests[2].url,
        `https://api.example.test/api/v1/trips/${TRIP_ID}/location/history` +
          `?to=2026-09-01T09%3A00%3A00.000Z`,
      );
    } finally {
      restore();
    }
  });

  it('surfaces non-2xx responses as ApiClientError with the envelope details', async () => {
    const { restore } = mockFetch(() =>
      jsonResponse(
        {
          success: false,
          message: 'Trip not found',
          details: { statusCode: 404, code: 'trip_not_found' },
        },
        404,
      ),
    );

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await assert.rejects(client.getTripLocation(TRIP_ID), (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.status, 404);
        return true;
      });
    } finally {
      restore();
    }
  });
});
