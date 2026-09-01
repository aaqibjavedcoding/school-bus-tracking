import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, readBrowserCookie, hasBrowserCookieJar } from '@school-bus-tracking/api-client';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

const originalFetch = globalThis.fetch;
const globalWithDocument = globalThis as { document?: { cookie: string } };

/** Payload of the API's `GET /api/v1/auth/csrf` endpoint, inside its envelope. */
function csrfEnvelope(token: string) {
  return { success: true, data: { csrf_token: token, header_name: 'x-csrf-token' } };
}

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

/**
 * Fetch stub that behaves like the API behind the Next.js `/api/v1` rewrite:
 * `GET /auth/csrf` seeds the readable `csrf_token` cookie, and every unsafe
 * request is run through the real double-submit rule (`refresh_token` cookie
 * present + no matching `X-CSRF-Token` header => 403).
 */
function stubApi(
  captured: CapturedRequest[],
  options: { sessionCookie?: boolean } = {},
): { jar: Map<string, string> } {
  const jar = new Map<string, string>();
  if (options.sessionCookie) {
    // httpOnly — sent by the browser, invisible to `document.cookie`.
    jar.set('refresh_token', 'stale-refresh-token');
  }
  const syncDocument = () => {
    const readable = [...jar.entries()]
      .filter(([name]) => name !== 'refresh_token')
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    globalWithDocument.document = { cookie: readable };
  };
  syncDocument();

  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    captured.push({ url, init });
    const method = (init.method || 'GET').toUpperCase();

    if (url.endsWith('/auth/csrf')) {
      jar.set('csrf_token', 'issued-csrf-token');
      syncDocument();
      return {
        ok: true,
        status: 200,
        json: async () => csrfEnvelope('issued-csrf-token'),
        text: async () => '',
      } as unknown as Response;
    }

    const header = headerOf(init, 'X-CSRF-Token');
    const cookie = jar.get('csrf_token');
    // Mirrors the API rule: bearer-authenticated calls are exempt, only
    // ambient cookie sessions need the double-submit token.
    const bearer = headerOf(init, 'Authorization');
    const csrfRequired = method !== 'GET' && !bearer && jar.has('refresh_token');
    if (csrfRequired && (!header || header !== cookie)) {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          error: { code: 'Forbidden', message: 'Invalid or missing CSRF token' },
        }),
        text: async () => '',
      } as unknown as Response;
    }

    if (url.endsWith('/auth/login')) {
      jar.set('refresh_token', 'fresh-refresh-token');
      jar.set('csrf_token', 'rotated-csrf-token');
      syncDocument();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { access_token: 'jwt', token_type: 'Bearer', expires_in: 900, user: {} },
        }),
        text: async () => '',
      } as unknown as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
      text: async () => '',
    } as unknown as Response;
  }) as typeof fetch;

  return { jar };
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
    assert.equal(hasBrowserCookieJar(), true);
  });

  it('returns null outside a browser', () => {
    assert.equal(readBrowserCookie('csrf_token'), null);
    assert.equal(hasBrowserCookieJar(), false);
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

    assert.equal(captured.length, 1, 'a bearer client must not call the CSRF endpoint');
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

/**
 * Regression: web login returned 403 "Invalid or missing CSRF token".
 *
 * A browser that still holds the httpOnly `refresh_token` cookie but no
 * `csrf_token` cookie (expired 12h TTL, a session predating the CSRF
 * rollout, a cleared cookie) used to send `POST /auth/login` with no
 * `X-CSRF-Token` header at all — and the API, seeing a session cookie
 * without a token, refused it. Nothing in the client ever called the
 * bootstrap endpoint, so the app could not recover: login, refresh and
 * logout were all rejected.
 */
describe('web auth flow: CSRF bootstrap (regression for the 403 login)', () => {
  let captured: CapturedRequest[];

  beforeEach(() => {
    captured = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete globalWithDocument.document;
  });

  it('acquires a token before login when the browser has a session cookie but none', async () => {
    stubApi(captured, { sessionCookie: true });
    const client = new ApiClient({ baseUrl: '/api/v1' });

    const envelope = await client.login({
      school_id: 'triumph-academy',
      email: 'admin@school.test',
      password: 'correct-horse-battery',
    });

    assert.equal(envelope.success, true, 'login must no longer be refused with 403');
    assert.deepEqual(
      captured.map((entry) => entry.url),
      ['/api/v1/auth/csrf', '/api/v1/auth/login'],
      'the token must be acquired before the state-changing login',
    );
    assert.equal(headerOf(captured[1].init, 'X-CSRF-Token'), 'issued-csrf-token');
    assert.equal(captured[1].init.credentials, 'include');
  });

  it('sends the credentialed GET that lets the browser store the cookie', async () => {
    stubApi(captured, { sessionCookie: true });
    const client = new ApiClient({ baseUrl: '/api/v1' });

    const token = await client.ensureCsrfToken();

    assert.equal(token, 'issued-csrf-token');
    assert.equal(captured[0].url, '/api/v1/auth/csrf');
    assert.equal((captured[0].init.method || 'GET').toUpperCase(), 'GET');
    assert.equal(captured[0].init.credentials, 'include');
  });

  it('reuses the cookie it already has instead of re-fetching', async () => {
    stubApi(captured, { sessionCookie: true });
    const client = new ApiClient({ baseUrl: '/api/v1' });

    await client.ensureCsrfToken();
    await client.ensureCsrfToken();

    assert.equal(captured.filter((entry) => entry.url.endsWith('/auth/csrf')).length, 1);
  });

  it('shares one bootstrap request between concurrent callers', async () => {
    stubApi(captured, { sessionCookie: true });
    const client = new ApiClient({ baseUrl: '/api/v1' });

    await Promise.all([client.ensureCsrfToken(), client.ensureCsrfToken()]);

    assert.equal(captured.filter((entry) => entry.url.endsWith('/auth/csrf')).length, 1);
  });

  it('covers refresh and logout, not only login', async () => {
    stubApi(captured, { sessionCookie: true });
    const client = new ApiClient({ baseUrl: '/api/v1' });

    await client.refresh();
    assert.deepEqual(
      captured.map((entry) => entry.url),
      ['/api/v1/auth/csrf', '/api/v1/auth/refresh'],
    );
    assert.equal(headerOf(captured[1].init, 'X-CSRF-Token'), 'issued-csrf-token');

    captured.length = 0;
    await client.logout();
    assert.equal(captured[0].url, '/api/v1/auth/logout');
    assert.equal(headerOf(captured[0].init, 'X-CSRF-Token'), 'issued-csrf-token');
  });

  it('re-seeds and replays once when the token was rotated or expired', async () => {
    // The jar holds a token the server no longer accepts (e.g. logout in
    // another tab cleared it server-side).
    const { jar } = stubApi(captured, { sessionCookie: true });
    jar.set('csrf_token', 'stale-token');
    globalWithDocument.document = { cookie: 'csrf_token=stale-token' };
    const client = new ApiClient({ baseUrl: '/api/v1' });

    // Make the first attempt fail: the server-side value differs from the
    // cookie the browser echoes.
    const originalStub = globalThis.fetch;
    let firstUnsafeSeen = false;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/auth/logout') && !firstUnsafeSeen) {
        firstUnsafeSeen = true;
        captured.push({ url, init });
        return {
          ok: false,
          status: 403,
          json: async () => ({
            success: false,
            error: { code: 'Forbidden', message: 'Invalid or missing CSRF token' },
          }),
          text: async () => '',
        } as unknown as Response;
      }
      return originalStub(url as unknown as RequestInfo, init);
    }) as typeof fetch;

    await client.logout();

    assert.deepEqual(
      captured.map((entry) => entry.url),
      ['/api/v1/auth/logout', '/api/v1/auth/csrf', '/api/v1/auth/logout'],
      'a CSRF rejection must be repaired once, then replayed',
    );
    assert.equal(headerOf(captured[2].init, 'X-CSRF-Token'), 'issued-csrf-token');
  });

  it('never retries a rejected origin in a loop', async () => {
    globalWithDocument.document = { cookie: '' };
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      captured.push({ url, init });
      if (url.endsWith('/auth/csrf')) {
        return {
          ok: true,
          status: 200,
          json: async () => csrfEnvelope('issued-csrf-token'),
          text: async () => '',
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          error: { code: 'Forbidden', message: 'Invalid or missing CSRF token' },
        }),
        text: async () => '',
      } as unknown as Response;
    }) as typeof fetch;

    const client = new ApiClient({ baseUrl: '/api/v1' });
    await assert.rejects(() => client.logout(), /status 403/);
    assert.equal(
      captured.filter((entry) => entry.url.endsWith('/auth/logout')).length,
      2,
      'exactly one replay, never a loop',
    );
  });

  it('leaves native (bearer) clients alone — no bootstrap, no header', async () => {
    stubApi(captured, { sessionCookie: true });
    // React Native has no cookie jar the client can read.
    delete globalWithDocument.document;
    const client = new ApiClient({
      baseUrl: 'http://10.0.2.2:3001/api/v1',
      getAccessToken: () => 'mobile-jwt',
    });

    await client.raiseSos({ trip_id: 'trip-1', type: 'MEDICAL' } as never);

    assert.equal(captured.length, 1, 'mobile must not call the CSRF endpoint');
    assert.equal(headerOf(captured[0].init, 'X-CSRF-Token'), undefined);
    assert.equal(headerOf(captured[0].init, 'Authorization'), 'Bearer mobile-jwt');
  });

  it('can be switched off explicitly for a non-browser embedding', async () => {
    stubApi(captured, { sessionCookie: true });
    globalWithDocument.document = { cookie: '' };
    const client = new ApiClient({ baseUrl: '/api/v1', csrfBootstrap: false });

    assert.equal(await client.ensureCsrfToken(), null);
    assert.equal(captured.length, 0);
  });
});
