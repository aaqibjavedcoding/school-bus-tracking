import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import { TripAttendanceStatus } from '@school-bus-tracking/shared-types';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const STOP_ID = '33333333-3333-4333-8333-333333333333';

describe('ApiClient trip attendance methods', () => {
  it('uses tenant-free nested endpoints and forwards manifest filters', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ success: true, data: { items: [], summary: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.listTripStudents(TRIP_ID);
      await client.listTripStudents(TRIP_ID, {
        status: TripAttendanceStatus.BOARDED,
        stop_id: STOP_ID,
      });
      await client.getTripStudent(TRIP_ID, STUDENT_ID);
      await client.boardTripStudent(TRIP_ID, STUDENT_ID);
      await client.dropTripStudent(TRIP_ID, STUDENT_ID);

      assert.deepEqual(
        requests.map((request) => `${request.method} ${request.url}`),
        [
          `GET https://api.example.test/api/v1/trips/${TRIP_ID}/students`,
          `GET https://api.example.test/api/v1/trips/${TRIP_ID}/students?status=BOARDED&stop_id=${STOP_ID}`,
          `GET https://api.example.test/api/v1/trips/${TRIP_ID}/students/${STUDENT_ID}`,
          `POST https://api.example.test/api/v1/trips/${TRIP_ID}/students/${STUDENT_ID}/board`,
          `POST https://api.example.test/api/v1/trips/${TRIP_ID}/students/${STUDENT_ID}/drop`,
        ],
      );

      // Board and drop carry no body at all: the server owns who and when.
      assert.equal(requests[3].body, undefined);
      assert.equal(requests[4].body, undefined);

      for (const request of requests) {
        assert.ok(!request.url.includes('school_id'));
        assert.ok(!request.url.includes('boarded_at'));
        assert.ok(!request.body?.includes('school_id'));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('encodes path parameters and unwraps the envelope', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          success: true,
          data: { student_id: STUDENT_ID, status: TripAttendanceStatus.BOARDED },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      const boarded = await client.boardTripStudent('trip id/1', 'student id/2');
      assert.equal(boarded.data?.status, TripAttendanceStatus.BOARDED);
      await client.listTripStudents('trip id/1');

      assert.deepEqual(urls, [
        'https://api.example.test/api/v1/trips/trip%20id%2F1/students/student%20id%2F2/board',
        'https://api.example.test/api/v1/trips/trip%20id%2F1/students',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces API errors as ApiClientError with the response status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, message: 'Trip not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await assert.rejects(
        client.dropTripStudent(TRIP_ID, STUDENT_ID),
        (error: { name: string; status: number }) => {
          assert.equal(error.name, 'ApiClientError');
          assert.equal(error.status, 404);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
