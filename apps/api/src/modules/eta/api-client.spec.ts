import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
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

function makeClient(): ApiClient {
  return new ApiClient({ baseUrl: '/api/v1' });
}

describe('ApiClient Task 22 ETA/arrival methods', () => {
  it('reads the approximate ETA from the tenant-free nested endpoint', async () => {
    const { requests, restore } = mockFetch(() =>
      jsonResponse({
        success: true,
        data: {
          trip_id: TRIP_ID,
          school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          trip_status: TripStatus.IN_PROGRESS,
          tracking_state: 'active',
          latest: null,
          speed_kmh: null,
          speed_source: null,
          current_stop: null,
          next_stop: null,
          items: [],
          eta_available: false,
        },
      }),
    );
    try {
      const response = await makeClient().getTripEta(TRIP_ID);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, `/api/v1/trips/${TRIP_ID}/eta`);
      assert.equal(requests[0].method, 'GET');
      assert.equal(response.data?.trip_id, TRIP_ID);
      assert.equal(response.data?.eta_available, false);
      assert.ok(!requests[0].url.includes('school_id'));
      assert.ok(!requests[0].url.includes('latitude'));
    } finally {
      restore();
    }
  });

  it('reads the recorded stop arrivals of the trip', async () => {
    const { requests, restore } = mockFetch(() =>
      jsonResponse({
        success: true,
        data: { trip_id: TRIP_ID, school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [] },
      }),
    );
    try {
      const response = await makeClient().getTripArrivals(TRIP_ID);
      assert.equal(requests[0].url, `/api/v1/trips/${TRIP_ID}/arrivals`);
      assert.equal(response.data?.items.length, 0);
    } finally {
      restore();
    }
  });

  it('reads the crew progress snapshot of the trip', async () => {
    const { requests, restore } = mockFetch(() =>
      jsonResponse({
        success: true,
        data: {
          trip_id: TRIP_ID,
          school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          trip_status: TripStatus.IN_PROGRESS,
          tracking_state: 'active',
          current_stop: null,
          next_stop: null,
          arrivals: [],
          eta: {
            trip_id: TRIP_ID,
            school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            trip_status: TripStatus.IN_PROGRESS,
            tracking_state: 'active',
            latest: null,
            speed_kmh: null,
            speed_source: null,
            current_stop: null,
            next_stop: null,
            items: [],
            eta_available: false,
          },
        },
      }),
    );
    try {
      const response = await makeClient().getTripProgress(TRIP_ID);
      assert.equal(requests[0].url, `/api/v1/trips/${TRIP_ID}/progress`);
      assert.equal(response.data?.tracking_state, 'active');
    } finally {
      restore();
    }
  });
});
