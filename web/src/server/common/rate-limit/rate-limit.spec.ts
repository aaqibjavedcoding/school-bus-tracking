import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { ConfigService, Reflector } from '../../framework';
import { RATE_LIMIT_EXCEEDED_CODE, RATE_LIMIT_POLICY_KEY } from './rate-limit.constants';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitExceededException } from './rate-limit-exceeded.exception';
import {
  buildRateLimitBuckets,
  extractLoginIdentity,
  resolveClientIp,
  retryAfterSeconds,
} from './rate-limit.keys';
import { MemoryRateLimitStore } from './rate-limit.store';
import { REDIS_RATE_LIMIT_UNAVAILABLE_MESSAGE, createRateLimitStore } from './rate-limit.store-factory';

describe('MemoryRateLimitStore', () => {
  it('counts within a window and rolls over when it expires', async () => {
    const store = new MemoryRateLimitStore();
    const first = await store.hit('k', 1000, 1_000);
    const second = await store.hit('k', 1000, 1_500);
    assert.deepEqual(first, { count: 1, resetAt: 2_000 });
    assert.deepEqual(second, { count: 2, resetAt: 2_000 });

    const rolled = await store.hit('k', 1000, 2_500);
    assert.deepEqual(rolled, { count: 1, resetAt: 3_500 });
  });

  it('keeps buckets independent and supports reset', async () => {
    const store = new MemoryRateLimitStore();
    await store.hit('a', 1000, 0);
    await store.hit('b', 1000, 0);
    assert.equal(store.peek('a', 0)?.count, 1);
    await store.reset('a');
    assert.equal(store.peek('a', 0), null);
    assert.equal(store.peek('b', 0)?.count, 1);
  });

  it('evicts expired windows once it grows past the cap', async () => {
    const store = new MemoryRateLimitStore(2);
    await store.hit('a', 10, 0);
    await store.hit('b', 10, 0);
    await store.hit('c', 10, 1_000);
    assert.equal(store.size, 1);
  });
});

describe('resolveClientIp', () => {
  it('ignores X-Forwarded-For unless the deployment trusts the proxy', () => {
    assert.equal(resolveClientIp('10.0.0.1', '1.2.3.4', false), '10.0.0.1');
    assert.equal(resolveClientIp('10.0.0.1', '1.2.3.4, 5.6.7.8', true), '1.2.3.4');
    assert.equal(resolveClientIp(undefined, undefined, true), 'unknown');
  });
});

describe('extractLoginIdentity', () => {
  it('normalizes school + email and falls back to the platform tenant', () => {
    assert.equal(
      extractLoginIdentity({ email: ' Admin@School.test ', school_id: ' ABC ' }),
      'abc:admin@school.test',
    );
    assert.equal(extractLoginIdentity({ email: 'root@platform.test' }), 'platform:root@platform.test');
    assert.equal(extractLoginIdentity({ school_id: 'abc' }), null);
    assert.equal(extractLoginIdentity(null), null);
  });
});

describe('buildRateLimitBuckets', () => {
  const policy = { limit: 10, windowMs: 60_000 };
  const login = { identityLimit: 5, identityWindowMs: 900_000 };

  it('keys by IP for anonymous callers and by user id once authenticated', () => {
    const anonymous = buildRateLimitBuckets({ policy: 'read_heavy', ip: '9.9.9.9' }, policy, login);
    assert.deepEqual(anonymous.map((bucket) => bucket.key), ['read_heavy|ip:9.9.9.9']);

    const authenticated = buildRateLimitBuckets(
      { policy: 'read_heavy', ip: '9.9.9.9', userId: 'user-1' },
      policy,
      login,
    );
    assert.deepEqual(authenticated.map((bucket) => bucket.key), ['read_heavy|user:user-1']);
  });

  it('adds a hashed identity bucket for login so credential stuffing is capped', () => {
    const buckets = buildRateLimitBuckets(
      { policy: 'auth_login', ip: '9.9.9.9', body: { email: 'a@b.test', school_id: 's' } },
      policy,
      login,
    );
    assert.equal(buckets.length, 2);
    assert.equal(buckets[1].limit, 5);
    assert.equal(buckets[1].windowMs, 900_000);
    assert.match(buckets[1].key, /^auth_login\|identity:[0-9a-f]{32}$/);
    // The raw email never appears in a bucket key.
    assert.equal(buckets[1].key.includes('a@b.test'), false);
  });
});

describe('retryAfterSeconds', () => {
  it('is always at least one second', () => {
    assert.equal(retryAfterSeconds(1_500, 1_000), 1);
    assert.equal(retryAfterSeconds(11_000, 1_000), 10);
    assert.equal(retryAfterSeconds(0, 1_000), 1);
  });
});

describe('createRateLimitStore', () => {
  it('builds the memory store', () => {
    assert.ok(createRateLimitStore('memory') instanceof MemoryRateLimitStore);
  });

  it('fails fast for the not-yet-implemented distributed store', () => {
    assert.throws(() => createRateLimitStore('redis'), (error: Error) => {
      assert.equal(error.message, REDIS_RATE_LIMIT_UNAVAILABLE_MESSAGE);
      return true;
    });
    assert.throws(() => createRateLimitStore('memcached'), /Unknown RATE_LIMIT_STORE/);
  });
});

interface FakeResponse {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
}

function makeContext(request: Record<string, unknown>, response: FakeResponse, policy?: string) {
  return {
    getType: () => 'http',
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    __policy: policy,
  } as unknown as ExecutionContext;
}

function makeGuard(
  policy: string | undefined,
  overrides: Record<string, unknown> = {},
): { guard: RateLimitGuard; store: MemoryRateLimitStore } {
  const values: Record<string, unknown> = {
    'rateLimit.enabled': true,
    'rateLimit.trustProxy': false,
    'rateLimit.policies.auth_login': { limit: 2, windowMs: 60_000 },
    'rateLimit.policies.read_heavy': { limit: 3, windowMs: 60_000 },
    'rateLimit.login.identityLimit': 2,
    'rateLimit.login.identityWindowMs': 900_000,
    ...overrides,
  };
  const configService = {
    get: <T>(key: string, fallback?: T) => (key in values ? (values[key] as T) : (fallback as T)),
  } as unknown as ConfigService;
  const reflector = {
    getAllAndOverride: () => policy,
  } as unknown as Reflector;
  const store = new MemoryRateLimitStore();
  return { guard: new RateLimitGuard(reflector, configService, store), store };
}

function fakeResponse(): FakeResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

describe('RateLimitGuard', () => {
  it('does nothing for routes without a policy', async () => {
    const { guard } = makeGuard(undefined);
    const response = fakeResponse();
    assert.equal(
      await guard.canActivate(makeContext({ ip: '1.1.1.1', headers: {} }, response)),
      true,
    );
    assert.deepEqual(response.headers, {});
  });

  it('allows requests up to the limit and then answers 429 with Retry-After', async () => {
    const { guard } = makeGuard('read_heavy');
    const response = fakeResponse();
    const context = makeContext({ ip: '1.1.1.1', headers: {} }, response);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal(await guard.canActivate(context), true);
    }
    assert.equal(response.headers['RateLimit-Limit'], '3');
    assert.equal(response.headers['RateLimit-Remaining'], '0');

    await assert.rejects(guard.canActivate(context), (error: unknown) => {
      assert.ok(error instanceof RateLimitExceededException);
      const body = error.getResponse() as { error: string; details: { retry_after_seconds: number } };
      assert.equal(error.getStatus(), 429);
      assert.equal(body.error, RATE_LIMIT_EXCEEDED_CODE);
      assert.ok(body.details.retry_after_seconds >= 1);
      return true;
    });
    assert.ok(response.headers['Retry-After']);
  });

  it('keeps separate counters per client', async () => {
    const { guard } = makeGuard('read_heavy');
    const response = fakeResponse();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await guard.canActivate(makeContext({ ip: '1.1.1.1', headers: {} }, response));
    }
    // A different school/device is unaffected.
    assert.equal(
      await guard.canActivate(makeContext({ ip: '2.2.2.2', headers: {} }, response)),
      true,
    );
  });

  it('throttles login by identity even when the IP rotates', async () => {
    const { guard } = makeGuard('auth_login');
    const response = fakeResponse();
    const body = { email: 'victim@school.test', school_id: 'school-a' };

    await guard.canActivate(makeContext({ ip: '1.1.1.1', headers: {}, body }, response));
    await guard.canActivate(makeContext({ ip: '2.2.2.2', headers: {}, body }, response));
    await assert.rejects(
      guard.canActivate(makeContext({ ip: '3.3.3.3', headers: {}, body }, response)),
      RateLimitExceededException,
    );

    // Another account from the same fresh IP still works — no collateral lockout.
    assert.equal(
      await guard.canActivate(
        makeContext(
          { ip: '4.4.4.4', headers: {}, body: { email: 'other@school.test', school_id: 'school-a' } },
          response,
        ),
      ),
      true,
    );
  });

  it('recovers automatically once the window rolls over (no permanent lockout)', async () => {
    const { guard, store } = makeGuard('read_heavy');
    const response = fakeResponse();
    const context = makeContext({ ip: '1.1.1.1', headers: {} }, response);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await guard.canActivate(context);
    }
    await assert.rejects(guard.canActivate(context), RateLimitExceededException);

    // Simulate the window expiring.
    await store.reset('read_heavy|ip:1.1.1.1');
    assert.equal(await guard.canActivate(context), true);
  });

  it('can be disabled through configuration', async () => {
    const { guard } = makeGuard('read_heavy', { 'rateLimit.enabled': false });
    const response = fakeResponse();
    const context = makeContext({ ip: '1.1.1.1', headers: {} }, response);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal(await guard.canActivate(context), true);
    }
  });

  it('exposes the metadata key used by the decorator', () => {
    assert.equal(RATE_LIMIT_POLICY_KEY, 'rate_limit_policy');
  });
});
