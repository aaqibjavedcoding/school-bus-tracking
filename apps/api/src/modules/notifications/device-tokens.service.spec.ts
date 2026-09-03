import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { UserRole } from '@school-bus-tracking/shared-types';
import { DeviceToken } from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { DeviceTokensService } from './device-tokens.service';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '11111111-1111-4111-8111-111111111112';

const ACTOR_A: AuthenticatedRequestUser = {
  id: USER_A,
  school_id: SCHOOL_A,
  role: UserRole.PARENT,
};

interface TokenRow {
  id: string;
  school_id: string;
  user_id: string;
  platform: 'android' | 'ios';
  token: string;
  is_active: boolean;
  last_seen_at: Date;
  update: (values: Record<string, unknown>) => Promise<TokenRow>;
}

function row(overrides: Partial<TokenRow> = {}): TokenRow {
  const target: TokenRow = {
    id: '22222222-2222-4222-8222-222222222222',
    school_id: SCHOOL_A,
    user_id: USER_A,
    platform: 'android',
    token: 'fcm-token',
    is_active: true,
    last_seen_at: new Date('2026-09-01T08:00:00.000Z'),
    update: async (values) => {
      Object.assign(target, values, { last_seen_at: new Date() });
      return target;
    },
  };
  Object.assign(target, overrides);
  return target;
}

function matchesWhere(
  record: Record<string, unknown>,
  where: Record<PropertyKey, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key];
    if (expected !== null && typeof expected === 'object') {
      const values = (expected as Record<symbol, unknown[]>)[Op.in];
      return Array.isArray(values) ? values.includes(actual) : actual === expected;
    }
    return actual === expected;
  });
}

function makeService(options: { initialRows?: TokenRow[] } = {}) {
  const rows = [...(options.initialRows ?? [])];
  let idCounter = 0;
  const repo = {
    findOne: async (query: { where: Record<PropertyKey, unknown> }) =>
      (rows.find((r) => matchesWhere(r as unknown as Record<string, unknown>, query.where)) ??
        null) as unknown as DeviceToken,
    create: async (values: Record<string, unknown>) => {
      idCounter += 1;
      const created = row({
        id: `created-${idCounter}`,
        school_id: values.school_id as string,
        user_id: values.user_id as string,
        platform: values.platform as 'android' | 'ios',
        token: values.token as string,
        is_active: values.is_active as boolean,
        last_seen_at: values.last_seen_at as Date,
      });
      rows.push(created);
      return created as unknown as DeviceToken;
    },
    findAll: async (query: { where: Record<PropertyKey, unknown>; order?: unknown }) =>
      rows
        .filter((r) => matchesWhere(r as unknown as Record<string, unknown>, query.where))
        .sort(
          (a, b) => b.last_seen_at.getTime() - a.last_seen_at.getTime(),
        ) as unknown as DeviceToken[],
    update: async (
      values: Record<string, unknown>,
      options: { where: Record<PropertyKey, unknown> },
    ) => {
      const affected = rows.filter((r) =>
        matchesWhere(r as unknown as Record<string, unknown>, options.where),
      );
      for (const r of affected) {
        await r.update(values);
      }
      return [affected.length, affected] as [number, TokenRow[]];
    },
  } as unknown as typeof DeviceToken;
  return { service: new DeviceTokensService(repo), rows };
}

describe('DeviceTokensService.register', () => {
  it('creates a new token row for the JWT scoped user', async () => {
    const { service, rows } = makeService();

    const result = await service.register(ACTOR_A, { token: 'fcm-new', platform: 'android' });

    assert.equal(result.school_id, SCHOOL_A);
    assert.equal(result.user_id, USER_A);
    assert.equal(result.token, 'fcm-new');
    assert.equal(result.platform, 'android');
    assert.equal(result.is_active, true);
    assert.equal(rows.length, 1);
  });

  it('refreshes an existing row instead of duplicating it', async () => {
    const existing = row({ token: 'fcm-new', last_seen_at: new Date('2026-01-01T00:00:00.000Z') });
    const { service, rows } = makeService({ initialRows: [existing] });

    const result = await service.register(ACTOR_A, { token: 'fcm-new', platform: 'ios' });

    assert.equal(rows.length, 1);
    assert.equal(result.platform, 'ios');
    assert.ok(new Date(result.last_seen_at).getTime() > Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('moves ownership to the caller when the token belongs to another user', async () => {
    const other = row({ user_id: USER_B, token: 'shared-token', is_active: false });
    const { service, rows } = makeService({ initialRows: [other] });

    const result = await service.register(ACTOR_A, { token: 'shared-token', platform: 'android' });

    assert.equal(rows.length, 1, 're-register never duplicates a token');
    assert.equal(result.user_id, USER_A);
    assert.equal(result.is_active, true);
    assert.equal(other.user_id, USER_A);
  });

  it('re-creates a token that was fully unregistered (findOne misses soft-deleted rows)', async () => {
    const { service, rows } = makeService(); // no rows: same as a soft-deleted row under paranoid scope

    await service.register(ACTOR_A, { token: 'again', platform: 'android' });
    await service.register(ACTOR_A, { token: 'again', platform: 'android' });

    // Second call finds the first row and updates it.
    assert.equal(rows.length, 1);
  });
});

describe('DeviceTokensService.unregister', () => {
  it('deactivates only the caller-owned token row', async () => {
    const mine = row({ token: 'mine' });
    const others = row({ id: 'other-id', user_id: USER_B, token: 'theirs' });
    const { service, rows } = makeService({ initialRows: [mine, others] });

    const result = await service.unregister(ACTOR_A, 'mine');

    assert.deepEqual(result, { removed: true });
    assert.equal(mine.is_active, false);
    assert.equal(others.is_active, true);
    assert.equal(rows.length, 2);
  });

  it('is idempotent for unknown and already-inactive tokens', async () => {
    const { service } = makeService();

    const result = await service.unregister(ACTOR_A, 'never-registered');
    assert.deepEqual(result, { removed: true });
  });
});

describe('DeviceTokensService push lookups', () => {
  it('returns only active tokens of the given school+user', async () => {
    const { service } = makeService({
      initialRows: [
        row({ token: 'a1', last_seen_at: new Date('2026-09-01T07:00:00.000Z') }),
        row({ token: 'a2', last_seen_at: new Date('2026-09-01T08:00:00.000Z') }),
        row({ token: 'inactive', is_active: false }),
        row({ id: 'b', school_id: SCHOOL_B, token: 'other-school' }),
        row({ id: 'c', user_id: USER_B, token: 'other-user' }),
      ],
    });

    const tokens = await service.findActiveTokenStrings(SCHOOL_A, USER_A);

    assert.deepEqual(tokens, ['a2', 'a1']); // newest first
  });

  it('deactivates scoped tokens only', async () => {
    const a = row({ token: 'stale-a' });
    const b = row({ id: 'b-id', user_id: USER_B, token: 'stale-b' });
    const keep = row({ token: 'stale-c', is_active: false });
    const { service } = makeService({ initialRows: [a, b, keep] });

    await service.deactivateTokens(SCHOOL_A, USER_A, ['stale-a', 'stale-b', 'stale-c']);

    assert.equal(a.is_active, false);
    assert.equal(b.is_active, true);
    assert.equal(keep.is_active, false);
  });

  it('deactivating an empty list is a no-op', async () => {
    const a = row({ token: 'a' });
    const { service } = makeService({ initialRows: [a] });

    await service.deactivateTokens(SCHOOL_A, USER_A, []);

    assert.equal(a.is_active, true);
  });
});
