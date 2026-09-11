import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';

/**
 * Single-flight refresh — the StrictMode boot regression.
 *
 * React StrictMode runs the AuthProvider effect twice on mount, so two
 * `refresh()` calls fired back to back used to send **two**
 * `POST /auth/refresh` requests. The API rotates the refresh token on every
 * success, so the second request carried an already-revoked token, got
 * `401 revoked`, and the failed response cleared the `sb_session` marker —
 * logging the user out on reload. The client must funnel every refresh entry
 * point (explicit boot refresh *and* the 401-retry path) through one shared
 * in-flight promise so the server sees exactly one request per window.
 */

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

interface PendingRequest {
  url: string;
  resolve: (response: Response) => void;
}

const originalFetch = globalThis.fetch;
const globalWithDocument = globalThis as { document?: { cookie: string } };

/** Minimal Response-like object whose `text()` and `json()` agree. */
function jsonResponse(status: number, body: unknown): Response {
  const raw = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(raw) as unknown,
    text: async () => raw,
  } as unknown as Response;
}

/** The API's success envelope for a rotated session. */
function refreshEnvelope(accessToken: string) {
  return {
    success: true,
    data: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: 'user-1' },
    },
  };
}

/** The API's 401 body for a revoked refresh token. */
const REVOKED_BODY = {
  success: false,
  error: { code: 'Unauthorized', message: 'Refresh token has been revoked' },
};

/** One macrotask tick: lets every queued microtask (including the client's
 * 401 handling) run before the test asserts on the request log. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = (init.headers || {}) as Record<string, string>;
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

describe('api client single-flight refresh', () => {
  let captured: CapturedRequest[];
  let pending: PendingRequest[];
  /** In-memory access-token store the client reads/writes. */
  let accessToken: string | null;

  beforeEach(() => {
    captured = [];
    pending = [];
    accessToken = null;
    // A readable CSRF cookie already in the jar: unsafe auth requests echo
    // it instead of paying for a `GET /auth/csrf` bootstrap, keeping the
    // request log exactly about the refresh behaviour under test.
    globalWithDocument.document = { cookie: 'csrf_token=test-csrf-token' };

    globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      captured.push({ url: requestUrl, init: (init ?? {}) as RequestInit });
      return new Promise<Response>((resolve) => {
        pending.push({ url: requestUrl, resolve: (response) => resolve(response) });
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    pending = [];
    globalThis.fetch = originalFetch;
    delete globalWithDocument.document;
  });

  /** Settles the first still-pending request whose URL contains `urlPart`. */
  function settle(urlPart: string, status: number, body: unknown): void {
    const index = pending.findIndex((entry) => entry.url.includes(urlPart));
    assert.notEqual(index, -1, `expected a pending request matching ${urlPart}`);
    const [entry] = pending.splice(index, 1);
    entry.resolve(jsonResponse(status, body));
  }

  function refreshRequests(): CapturedRequest[] {
    return captured.filter((entry) => entry.url.endsWith('/auth/refresh'));
  }

  function makeClient(): ApiClient {
    return new ApiClient({
      baseUrl: '/api/v1',
      getAccessToken: () => accessToken,
      setAccessToken: (token) => {
        accessToken = token;
      },
    });
  }

  it('shares one in-flight POST /auth/refresh between concurrent boot calls', async () => {
    const client = makeClient();

    // React StrictMode: two effect instances fire their boot refresh in the
    // same tick, before either response can settle.
    const first = client.refresh();
    const second = client.refresh();

    await tick();
    assert.equal(
      refreshRequests().length,
      1,
      'concurrent boot refreshes must collapse into a single request',
    );

    settle('/auth/refresh', 200, refreshEnvelope('fresh-jwt'));
    const [firstEnvelope, secondEnvelope] = await Promise.all([first, second]);

    assert.equal(refreshRequests().length, 1);
    assert.equal(firstEnvelope.data?.access_token, 'fresh-jwt');
    assert.equal(secondEnvelope.data?.access_token, 'fresh-jwt');
    assert.equal(accessToken, 'fresh-jwt');
  });

  it('shares the in-flight refresh between an explicit boot call and the 401 retry path', async () => {
    accessToken = 'stale-jwt';
    const client = makeClient();

    // A data call goes out with the stale token and 401s; while the client
    // is mid-refresh, the (doubled) boot refresh lands too.
    const listing = client.get('/students');
    await tick();
    settle('/students', 401, REVOKED_BODY);
    await tick();
    assert.equal(
      refreshRequests().length,
      1,
      'the 401 retry must have started exactly one refresh',
    );

    const boot = client.refresh();
    await tick();
    assert.equal(
      refreshRequests().length,
      1,
      'the explicit boot refresh must join the in-flight request, not start a second one',
    );

    settle('/auth/refresh', 200, refreshEnvelope('fresh-jwt'));
    await tick();
    settle('/students', 200, { success: true, data: { items: [], total: 0 } });
    const [listingEnvelope, bootEnvelope] = await Promise.all([listing, boot]);

    assert.equal(refreshRequests().length, 1);
    assert.equal(bootEnvelope.data?.access_token, 'fresh-jwt');
    assert.ok(listingEnvelope.success, 'the 401 data call must be replayed after the refresh');
    const retriedGet = captured.filter((entry) => entry.url.endsWith('/students')).at(-1);
    assert.equal(headerOf(retriedGet?.init ?? {}, 'Authorization'), 'Bearer fresh-jwt');
    assert.equal(accessToken, 'fresh-jwt');
  });

  it('sends exactly one refresh for a burst of concurrent 401s', async () => {
    accessToken = 'stale-jwt';
    const client = makeClient();

    const first = client.get('/students');
    const second = client.get('/buses');
    await tick();
    settle('/students', 401, REVOKED_BODY);
    settle('/buses', 401, REVOKED_BODY);
    await tick();
    await tick();

    assert.equal(
      refreshRequests().length,
      1,
      'every 401 in the burst must share the same in-flight refresh',
    );

    settle('/auth/refresh', 200, refreshEnvelope('fresh-jwt'));
    await tick();
    const retried = captured
      .filter((entry) => entry.url.endsWith('/students'))
      .concat(captured.filter((entry) => entry.url.endsWith('/buses')))
      .filter((entry) => headerOf(entry.init, 'Authorization') === 'Bearer fresh-jwt');
    assert.equal(retried.length, 2, 'both data calls must replay with the fresh token');

    settle('/students', 200, { success: true, data: { items: [], total: 0 } });
    settle('/buses', 200, { success: true, data: { items: [], total: 0 } });
    const [firstEnvelope, secondEnvelope] = await Promise.all([first, second]);

    assert.equal(refreshRequests().length, 1);
    assert.ok(firstEnvelope.success);
    assert.ok(secondEnvelope.success);
  });

  it('releases the single-flight slot after a failed refresh so the next attempt is a fresh request', async () => {
    accessToken = 'stale-jwt';
    const client = makeClient();

    const failed = client.refresh();
    await tick();
    settle('/auth/refresh', 401, REVOKED_BODY);
    await assert.rejects(failed, /401/);
    assert.equal(
      accessToken,
      null,
      'a failed refresh must drop the in-memory token it can no longer rely on',
    );
    assert.equal(refreshRequests().length, 1);

    // A later call (e.g. the user re-logging in, or the next boot) must not
    // be stuck on the poisoned promise — it sends a brand-new request.
    const retry = client.refresh();
    await tick();
    assert.equal(refreshRequests().length, 2);
    settle('/auth/refresh', 200, refreshEnvelope('fresh-jwt'));
    const envelope = await retry;
    assert.equal(envelope.data?.access_token, 'fresh-jwt');
    assert.equal(accessToken, 'fresh-jwt');
  });

  it('does not memoize: sequential refreshes each send their own request', async () => {
    const client = makeClient();

    const first = client.refresh();
    await tick();
    settle('/auth/refresh', 200, refreshEnvelope('jwt-a'));
    await first;

    const second = client.refresh();
    await tick();
    settle('/auth/refresh', 200, refreshEnvelope('jwt-b'));
    const envelope = await second;

    assert.equal(refreshRequests().length, 2);
    assert.equal(envelope.data?.access_token, 'jwt-b');
    assert.equal(accessToken, 'jwt-b');
  });
});
