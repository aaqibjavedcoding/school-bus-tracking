import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiClientError } from '@school-bus-tracking/api-client';
import { ImportModule } from '@school-bus-tracking/shared-types';

/**
 * Regression: admin dashboard / route detail showed
 * `Unable to load — Failed to execute 'text' on 'Response': body stream already read`.
 *
 * `request()` and `downloadFile()` used to call `response.json()` and fall back
 * to `response.text()` in the catch. After `json()` threw on an HTML or empty
 * body, the stream was already consumed, so `text()` itself threw a TypeError
 * that hid the real HTTP status. A single `text()` + optional `JSON.parse`
 * keeps `ApiClientError.status` / `.details` honest for every content type.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubErrorResponse(status: number, body: string, contentType?: string): void {
  globalThis.fetch = (async () => {
    const headers = new Headers();
    if (contentType) {
      headers.set('content-type', contentType);
    }
    return new Response(body, { status, headers });
  }) as typeof fetch;
}

describe('ApiClient error body reading', () => {
  it('surfaces a 500 HTML body as ApiClientError with status 500 and the raw text', async () => {
    const html = '<html><body><h1>Internal Server Error</h1><p>upstream crashed</p></body></html>';
    stubErrorResponse(500, html, 'text/html');

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await assert.rejects(client.getHealth(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 500);
      assert.equal(error.details, html);
      assert.match(error.message, /status 500/);
      assert.match(error.message, /Internal Server Error/);
      assert.equal(error.name, 'ApiClientError');
      // Must not be the masked TypeError that hid the real failure.
      assert.ok(!/body stream already read/i.test(error.message));
      return true;
    });
  });

  it('surfaces a 500 empty body without crashing', async () => {
    stubErrorResponse(500, '', 'text/plain');

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await assert.rejects(client.getDashboardStats(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 500);
      assert.equal(error.details, undefined);
      assert.match(error.message, /status 500/);
      assert.ok(!/body stream already read/i.test(error.message));
      return true;
    });
  });

  it('keeps the normal JSON error envelope intact', async () => {
    const envelope = {
      success: false,
      error: {
        code: 'Bad Request',
        message: 'property include should not exist',
        details: { include: 'property include should not exist' },
      },
    };
    stubErrorResponse(400, JSON.stringify(envelope), 'application/json');

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await assert.rejects(client.listStops({ include: 'minimal' }), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.details, envelope);
      assert.equal(error.message, 'Request failed with status 400');
      return true;
    });
  });

  it('surfaces non-JSON download errors without a body-stream TypeError', async () => {
    const html = '<html>gateway timeout</html>';
    stubErrorResponse(504, html, 'text/html');

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await assert.rejects(client.downloadImportTemplate(ImportModule.STUDENTS), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 504);
      assert.equal(error.details, html);
      assert.ok(!/body stream already read/i.test(error.message));
      return true;
    });
  });

  it('truncates a long non-JSON body in the error message (~200 chars)', async () => {
    const long = 'x'.repeat(500);
    stubErrorResponse(502, long, 'text/plain');

    const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
    await assert.rejects(client.getHealth(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 502);
      assert.equal(error.details, long);
      // Full body stays on `.details`; the message only carries a preview.
      assert.ok(error.message.length < 250);
      assert.match(error.message, /status 502: x{200}$/);
      return true;
    });
  });
});
