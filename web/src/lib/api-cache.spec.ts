import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiCache, FRESH_TTL_MS, STALE_TTL_MS, cacheKey, isCacheableGet } from './api-cache.ts';

describe('api-cache keying', () => {
  it('keys by method, scope and endpoint (query string included)', () => {
    assert.equal(cacheKey('GET', '/students?page=2', '-'), 'GET - /students?page=2');
    assert.notEqual(
      cacheKey('GET', '/students?page=1', 'a'),
      cacheKey('GET', '/students?page=2', 'a'),
    );
    assert.notEqual(cacheKey('GET', '/students', 'a'), cacheKey('GET', '/students', 'b'));
  });

  it('caches only list-shaped tenant GETs', () => {
    assert.ok(isCacheableGet('/students?limit=20'));
    assert.ok(isCacheableGet('/dashboard/stats'));
    assert.ok(isCacheableGet('/reports/students_by_route?page=1'));
    assert.ok(!isCacheableGet('/students/3f1d0c5e-59c6-4a96-88de-1d2fbca5c113'));
    assert.ok(!isCacheableGet('/live-tracking/trips/x/location'));
    assert.ok(!isCacheableGet('/notifications'));
    assert.ok(!isCacheableGet('/auth/login'));
  });
});

describe('ApiCache', () => {
  it('serves fresh entries without a refetch', () => {
    const cache = new ApiCache();
    const key = cacheKey('GET', '/students', '-');
    cache.set(key, { items: [1] }, 1_000);

    const hit = cache.peek<{ items: number[] }>(key, 1_000 + FRESH_TTL_MS - 1);
    assert.deepEqual(hit.value, { items: [1] });
    assert.equal(hit.isStale, false);
  });

  it('flags stale entries so the caller can revalidate in the background', () => {
    const cache = new ApiCache();
    const key = cacheKey('GET', '/routes', '-');
    cache.set(key, { items: [] }, 1_000);

    const hit = cache.peek<unknown>(key, 1_000 + FRESH_TTL_MS + 1);
    assert.notEqual(hit.value, null, 'stale entries are still served');
    assert.equal(hit.isStale, true);
  });

  it('drops entries once they are too old even for stale-while-revalidate', () => {
    const cache = new ApiCache();
    const key = cacheKey('GET', '/buses', '-');
    cache.set(key, { items: [] }, 1_000);

    const miss = cache.peek<unknown>(key, 1_000 + STALE_TTL_MS + 1);
    assert.equal(miss.value, null);
  });

  it('evicts the oldest entry when the cache overflows', () => {
    const cache = new ApiCache();
    for (let index = 0; index < 205; index += 1) {
      cache.set(`k${index}`, index, 1_000 + index);
    }
    assert.equal(cache.stats().entries <= 200, true);
    assert.equal(cache.peek('k0', 100_000).value, null, 'oldest entry evicted');
    assert.equal(cache.peek('k204', 100_000).value, 204, 'newest entry kept');
  });

  it('shares one inflight promise between concurrent callers', async () => {
    const cache = new ApiCache();
    const key = cacheKey('GET', '/trips', '-');
    let fetches = 0;

    const load = async () => {
      const shared = cache.inflightFor<{ n: number }>(key);
      if (shared) return shared;
      fetches += 1;
      const promise = Promise.resolve({ n: fetches });
      return cache.trackInflight<{ n: number }>(key, promise);
    };

    const [a, b] = await Promise.all([load(), load()]);
    assert.equal(fetches, 1);
    assert.equal(a.n, 1);
    assert.equal(b.n, 1);
    assert.equal(cache.inflightFor(key), null, 'inflight map is cleaned up');
  });

  it('clear() drops every entry (mutation invalidation)', () => {
    const cache = new ApiCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.peek('a').value, null);
    assert.equal(cache.peek('b').value, null);
  });
});
