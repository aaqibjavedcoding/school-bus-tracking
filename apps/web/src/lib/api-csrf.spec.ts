import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, readBrowserCookie } from '@school-bus-tracking/api-client';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

const originalFetch = globalThis.fetch;
const globalWithDocument = globalThis as { document?: { cookie: string } };

function stubFetch(captured: CapturedRequest[]): void {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    captured.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
      text: async () => '',
    } as unknown as Response;
  }) as typeof fetch;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = (init.headers || {}) as Record<string, string>;
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

describe('api client CSRF double submit', () => {
  let captured: CapturedRequest[];

  beforeEach(() => {
    captured = [];
    stubFetch(captured);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalWithDocument.document;
  });

  it('reads the readable CSRF cookie from the browser jar', () => {
    globalWithDocument.document = { cookie: 'other=1; csrf_token=abc%20123; more=2' };
    assert.equal(readBrowserCookie('csrf_token'), 'abc 123');
    assert.equal(readBrowserCookie('missing'), null);
  });

  it('returns null outside a browser', () => {
    assert.equal(readBrowserCookie('csrf_token'), null);
  });

  it('echoes the cookie in X-CSRF-Token on unsafe requests', async () => {
    globalWithDocument.document = { cookie: 'csrf_token=token-value' };
    const client = new ApiClient({ baseUrl: 'http://localhost/api/v1' });

    await client.logout();

    assert.equal(captured.length, 1);
    assert.equal(headerOf(captured[0].init, 'X-CSRF-Token'), 'token-value');
  });

  it('does not send the header on safe requests', async () => {
    globalWithDocument.document = { cookie: 'csrf_token=token-value' };
    const client = new ApiClient({
      baseUrl: 'http://localhost/api/v1',
      getAccessToken: () => 'jwt',
    });

    await client.listBuses();

    assert.equal(headerOf(captured[0].init, 'X-CSRF-Token'), undefined);
  });

  it('omits the header when there is no cookie (mobile / bearer clients)', async () => {
    const client = new ApiClient({
      baseUrl: 'http://localhost/api/v1',
      getAccessToken: () => 'jwt',
    });

    await client.createBus({ registration_number: 'AB-1', capacity: 10 });

    assert.equal(headerOf(captured[0].init, 'X-CSRF-Token'), undefined);
    assert.equal(headerOf(captured[0].init, 'Authorization'), 'Bearer jwt');
  });

  it('honours a custom cookie and header name', async () => {
    globalWithDocument.document = { cookie: 'xsrf=custom-value' };
    const client = new ApiClient({
      baseUrl: 'http://localhost/api/v1',
      csrfCookieName: 'xsrf',
      csrfHeaderName: 'X-XSRF-Token',
    });

    await client.logout();

    assert.equal(headerOf(captured[0].init, 'X-XSRF-Token'), 'custom-value');
  });
});
