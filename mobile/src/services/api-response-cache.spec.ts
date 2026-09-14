import { afterEach, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClientError, type ApiClient } from '@school-bus-tracking/api-client';
import { applyResponseCache } from './api.ts';
import { apiCache } from './api-cache.ts';

/**
 * Regression coverage for the in-memory response cache's stale-while-
 * revalidate path.
 *
 * The driver mobile app logged repeated `ApiClientError: Request failed with
 * status 403` rejections. The visible crew-request 403s came from
 * admin-only endpoints (fixed by not calling them); the *repeated log
 * entries* came from here: a stale revalidation is fire-and-forget, and a
 * rejected promise with no handler surfaces as an unhandled rejection in the
 * device log. These tests pin the contract:
 *
 *  - foreground failures still reach the caller (no suppression);
 *  - a failed background revalidation never becomes an unhandled
 *    rejection, keeps the stale entry for the next visit, and is logged;
 *  - a successful revalidation still refreshes the entry (normal SWR).
 */

const FRESH_TTL_MS = 30_000;

interface FakeClient {
  get: (endpoint: string, options?: RequestInit) => Promise<Record<string, unknown>>;
  post: (endpoint: string, body?: unknown) => Promise<Record<string, unknown>>;
  patch: (endpoint: string, body?: unknown) => Promise<Record<string, unknown>>;
  put: (endpoint: string, body?: unknown) => Promise<Record<string, unknown>>;
  delete: (endpoint: string) => Promise<Record<string, unknown>>;
}

function makeClient(impl: (endpoint: string) => Promise<Record<string, unknown>>): FakeClient {
  return {
    get: (endpoint) => impl(endpoint),
    post: async () => ({ success: true }),
    patch: async () => ({ success: true }),
    put: async () => ({ success: true }),
    delete: async () => ({ success: true }),
  };
}

/** Lets microtasks and the fire-and-forget revalidation settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('applyResponseCache — stale-while-revalidate failure handling', () => {
  let realNow: () => number;
  let now: number;
  let unhandled: Array<unknown>;
  let unhandledListener: (reason: unknown) => void;
  let warnSpy: (message: string) => void;
  let realWarn: typeof console.warn;
  let warnings: string[];

  beforeEach(() => {
    realNow = Date.now;
    now = Date.now();
    Date.now = () => now;

    unhandled = [];
    unhandledListener = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', unhandledListener);

    warnings = [];
    realWarn = console.warn;
    warnSpy = (message: string) => {
      warnings.push(message);
    };
    console.warn = warnSpy;

    apiCache.clear();
  });

  afterEach(() => {
    Date.now = realNow;
    process.off('unhandledRejection', unhandledListener);
    console.warn = realWarn;
    apiCache.clear();
  });

  it('foreground GET failures still reach the caller (403s are not suppressed)', async () => {
    const failing = makeClient(async () => {
      throw new ApiClientError('Request failed with status 403', 403);
    });
    const cached = applyResponseCache(failing as unknown as ApiClient);

    await assert.rejects(
      () => cached.get('/trips?page=1'),
      (error: unknown) => error instanceof ApiClientError && error.status === 403,
    );
    // A failure is not cached: the next call re-tries the network.
    await assert.rejects(
      () => cached.get('/trips?page=1'),
      (error: unknown) => error instanceof ApiClientError && error.status === 403,
    );
  });

  it('a failed background revalidation never becomes an unhandled rejection', async () => {
    let calls = 0;
    let shouldFail = false;
    const client = makeClient(async () => {
      calls += 1;
      if (shouldFail) {
        throw new ApiClientError('Request failed with status 403', 403);
      }
      return { success: true, data: { n: calls } };
    });
    const cached = applyResponseCache(client as unknown as ApiClient);

    // Seed a fresh entry (network call #1).
    await cached.get('/trips?date=1');
    assert.equal(calls, 1);

    // Age past the fresh TTL but inside the stale window, then break the API.
    now += FRESH_TTL_MS + 1_000;
    shouldFail = true;

    // The stale value is served instantly; the background revalidation fails.
    const second = await cached.get('/trips?date=1');
    assert.deepEqual(second.data, { n: 1 }, 'stale value is served while revalidating');
    await settle();
    assert.equal(calls, 2, 'the background revalidation did run once');

    // The core regression: the rejected revalidation is owned — no
    // unhandled `ApiClientError` rejection lands in the device log.
    assert.equal(unhandled.length, 0, 'no unhandled rejection from the background revalidation');

    // The failure is logged (not silently swallowed, not thrown): the
    // endpoint and the error message are visible to whoever reads the log.
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\/trips\?date=1/);
    assert.match(warnings[0], /403/);

    // The stale entry survives the failed revalidation for the next visit.
    const third = await cached.get('/trips?date=1');
    assert.deepEqual(third.data, { n: 1 });
  });

  it('a successful revalidation still refreshes the entry (normal SWR keeps working)', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return { success: true, data: { n: calls } };
    });
    const cached = applyResponseCache(client as unknown as ApiClient);

    const first = await cached.get('/buses?page=1');
    assert.deepEqual(first.data, { n: 1 });

    now += FRESH_TTL_MS + 1_000;
    const second = await cached.get('/buses?page=1'); // stale → revalidates
    assert.deepEqual(second.data, { n: 1 });
    await settle();
    assert.equal(calls, 2);

    // The revalidated entry is fresh again: served without another network
    // call, with the new payload.
    const third = await cached.get('/buses?page=1');
    assert.deepEqual(third.data, { n: 2 });
    assert.equal(calls, 2);
  });

  it('mutations still clear the cache (invalidation untouched)', async () => {
    let calls = 0;
    const client = makeClient(async () => {
      calls += 1;
      return { success: true, data: { n: calls } };
    });
    const cached = applyResponseCache(client as unknown as ApiClient);

    await cached.get('/students?page=1');
    assert.equal(calls, 1);
    await cached.post('/students', { name: 'x' });
    await cached.get('/students?page=1');
    assert.equal(calls, 2, 'a mutation drops the cached list');
  });
});
