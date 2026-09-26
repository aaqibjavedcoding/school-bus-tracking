import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ExecutionContext } from '../../framework';
import { ConfigService, Reflector } from '../../framework';
import { RATE_LIMIT_EXCEEDED_CODE, RATE_LIMIT_POLICY_KEY } from './rate-limit.constants';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitExceededException } from './rate-limit-exceeded.exception';
import {
  buildRateLimitBuckets,
  extractCrewLoginIdentity,
  extractLoginIdentity,
  hashIdentity,
  resolveClientIp,
  retryAfterSeconds,
} from './rate-limit.keys';
import { MemoryRateLimitStore } from './rate-limit.store';
import {
  REDIS_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  createRateLimitStore,
} from './rate-limit.store-factory';

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

  it('starts empty — a restarted process gets fresh buckets (documented single-instance behaviour)', async () => {
    // Documents the restart semantics of the process-local store: counters do
    // not survive a process restart, so a brute-force window also resets.
    // See docs/security.md ("Rate limiting — deployment assumptions").
    const first = new MemoryRateLimitStore();
    await first.hit('auth_login|ip:1.2.3.4', 60_000, 0);
    await first.hit('auth_login|ip:1.2.3.4', 60_000, 0);
    assert.equal(first.peek('auth_login|ip:1.2.3.4', 0)?.count, 2);

    const restarted = new MemoryRateLimitStore();
    assert.equal(restarted.peek('auth_login|ip:1.2.3.4', 0), null);
    const afterRestart = await restarted.hit('auth_login|ip:1.2.3.4', 60_000, 0);
    assert.deepEqual(afterRestart, { count: 1, resetAt: 60_000 });
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
    assert.equal(
      extractLoginIdentity({ email: 'root@platform.test' }),
      'platform:root@platform.test',
    );
    assert.equal(extractLoginIdentity({ school_id: 'abc' }), null);
    assert.equal(extractLoginIdentity(null), null);
  });
});

describe('extractCrewLoginIdentity', () => {
  it('keys the PIN branch on the submitted school, lower-cased and trimmed', () => {
    // A crew PIN login names no user, so the school is the only identity an
    // attempt has. This is what stops one host from sweeping PINs across a list
    // of school codes.
    assert.equal(
      extractCrewLoginIdentity({ method: 'pin', school_id: ' Lincoln-High ', pin: '1234' }),
      'pin:lincoln-high',
    );
    assert.equal(
      extractCrewLoginIdentity({ method: 'pin', school_id: 'lincoln-high', pin: '9999' }),
      'pin:lincoln-high',
      'the PIN must not widen the bucket — different guesses, one identity',
    );
  });

  it('gives an unresolvable school code its own bucket rather than sharing one', () => {
    // The guard runs before any database work, so a code that resolves to
    // nothing is still keyed on the raw string. Bucketing every typo together
    // would let an attacker burn one shared allowance instead of their own.
    assert.equal(
      extractCrewLoginIdentity({ method: 'pin', school_id: 'no-such-school', pin: '1234' }),
      'pin:no-such-school',
    );
    assert.notEqual(
      extractCrewLoginIdentity({ method: 'pin', school_id: 'no-such-school' }),
      extractCrewLoginIdentity({ method: 'pin', school_id: 'other-typo' }),
    );
  });

  it('returns null when there is nothing to key on, and never echoes the PIN', () => {
    assert.equal(extractCrewLoginIdentity({ method: 'pin', pin: '1234' }), null);
    assert.equal(extractCrewLoginIdentity({ method: 'pin', school_id: '  ', pin: '1234' }), null);
    assert.equal(extractCrewLoginIdentity({ method: 'qr' }), null);
    assert.equal(extractCrewLoginIdentity(null), null);

    const identity = extractCrewLoginIdentity({
      method: 'pin',
      school_id: 'lincoln-high',
      pin: '4821',
    })!;
    assert.ok(!identity.includes('4821'), 'the PIN must never enter a bucket key');
    assert.ok(!hashIdentity(identity).includes('4821'));
  });

  it('keeps the QR branch keyed on the presented pairing code', () => {
    assert.equal(extractCrewLoginIdentity({ method: 'qr', pairing_token: ' abc ' }), 'qr:abc');
    assert.equal(extractCrewLoginIdentity({ method: 'qr', pairing_token: '' }), null);
  });

  it('lands in the crew identity bucket of the auth_crew_login policy only', () => {
    const policy = { limit: 10, windowMs: 60_000 };
    const login = { identityLimit: 5, identityWindowMs: 900_000 };
    const buckets = buildRateLimitBuckets(
      {
        policy: 'auth_crew_login',
        ip: '1.2.3.4',
        body: { method: 'pin', school_id: 'lincoln-high', pin: '1234' },
      },
      policy,
      login,
      { identityLimit: 8, identityWindowMs: 900_000 },
    );
    assert.equal(buckets.length, 2, 'an IP bucket plus the per-school identity bucket');
    assert.equal(buckets[1]!.key, `auth_crew_login|identity:${hashIdentity('pin:lincoln-high')}`);
    assert.equal(buckets[1]!.limit, 8, 'the crew settings, not the email-login ones');
  });
});

describe('buildRateLimitBuckets', () => {
  const policy = { limit: 10, windowMs: 60_000 };
  const login = { identityLimit: 5, identityWindowMs: 900_000 };

  it('keys by IP for anonymous callers and by user id once authenticated', () => {
    const anonymous = buildRateLimitBuckets({ policy: 'read_heavy', ip: '9.9.9.9' }, policy, login);
    assert.deepEqual(
      anonymous.map((bucket) => bucket.key),
      ['read_heavy|ip:9.9.9.9'],
    );

    const authenticated = buildRateLimitBuckets(
      { policy: 'read_heavy', ip: '9.9.9.9', userId: 'user-1' },
      policy,
      login,
    );
    assert.deepEqual(
      authenticated.map((bucket) => bucket.key),
      ['read_heavy|user:user-1'],
    );
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

  /**
   * The public password-reset pair.
   *
   * It reuses the login identity (school + email) but its **own** allowance,
   * because the two bound different things: a login attempt costs the
   * attacker a guess, a forgot-password request costs the victim an email.
   */
  const publicReset = { identityLimit: 3, identityWindowMs: 3_600_000 };

  it('caps a forgot-password flood per mailbox, not just per IP', () => {
    const buckets = buildRateLimitBuckets(
      {
        policy: 'password_reset_public',
        ip: '9.9.9.9',
        body: { school_id: 'lincoln-high', email: 'head@lincoln.test' },
      },
      policy,
      login,
      undefined,
      publicReset,
    );

    assert.equal(buckets.length, 2, 'an IP bucket plus the per-identity bucket');
    assert.equal(buckets[0].key, 'password_reset_public|ip:9.9.9.9');
    // Its own, much tighter allowance — not the login one.
    assert.equal(buckets[1].limit, 3);
    assert.equal(buckets[1].windowMs, 3_600_000);
    assert.match(buckets[1].key, /^password_reset_public\|identity:[0-9a-f]{32}$/);
    assert.equal(buckets[1].key.includes('head@lincoln.test'), false);
  });

  it('follows the mailbox across rotating IPs, and normalises the identity', () => {
    const bucketsFor = (ip: string, body: Record<string, string>) =>
      buildRateLimitBuckets(
        { policy: 'password_reset_public', ip, body },
        policy,
        login,
        undefined,
        publicReset,
      );

    const first = bucketsFor('9.9.9.9', { school_id: 'lincoln-high', email: 'head@lincoln.test' });
    // A botnet changes the IP bucket but not the identity one — which is the
    // bucket that stops one admin's inbox being used as a weapon.
    const botnet = bucketsFor('8.8.8.8', { school_id: 'lincoln-high', email: 'head@lincoln.test' });
    assert.notEqual(first[0].key, botnet[0].key);
    assert.equal(first[1].key, botnet[1].key);

    // Case and padding must not open a second bucket for the same mailbox.
    const sloppy = bucketsFor('9.9.9.9', {
      school_id: ' LINCOLN-HIGH ',
      email: ' Head@Lincoln.test ',
    });
    assert.equal(sloppy[1].key, first[1].key);

    const other = bucketsFor('9.9.9.9', { school_id: 'lincoln-high', email: 'other@lincoln.test' });
    assert.notEqual(other[1].key, first[1].key);
  });

  it('falls back to the IP bucket alone when there is no identity to key on', () => {
    // `POST /auth/reset-password` carries a token and a password, no mailbox:
    // it shares the policy but can only be limited by IP. And the password
    // must never reach a bucket key.
    const buckets = buildRateLimitBuckets(
      {
        policy: 'password_reset_public',
        ip: '9.9.9.9',
        body: { token: 'a'.repeat(64), password: 'new-password-123' },
      },
      policy,
      login,
      undefined,
      publicReset,
    );
    assert.deepEqual(
      buckets.map((bucket) => bucket.key),
      ['password_reset_public|ip:9.9.9.9'],
    );
  });

  it('is distinct from the admin-initiated password_reset policy', () => {
    // The privileged, authenticated reset keeps its own (looser) policy and
    // gains no identity bucket from this change.
    const admin = buildRateLimitBuckets(
      {
        policy: 'password_reset',
        ip: '9.9.9.9',
        userId: 'admin-1',
        body: { school_id: 'lincoln-high', email: 'head@lincoln.test' },
      },
      policy,
      login,
      undefined,
      publicReset,
    );
    assert.deepEqual(
      admin.map((bucket) => bucket.key),
      ['password_reset|user:admin-1'],
    );
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
    assert.throws(
      () => createRateLimitStore('redis'),
      (error: Error) => {
        assert.equal(error.message, REDIS_RATE_LIMIT_UNAVAILABLE_MESSAGE);
        return true;
      },
    );
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
      const body = error.getResponse() as {
        error: string;
        details: { retry_after_seconds: number };
      };
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
          {
            ip: '4.4.4.4',
            headers: {},
            body: { email: 'other@school.test', school_id: 'school-a' },
          },
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
