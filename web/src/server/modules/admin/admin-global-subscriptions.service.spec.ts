import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { PlanBillingPeriod, SubscriptionStatus, UserRole } from '@school-bus-tracking/shared-types';
import { AdminGlobalSubscriptionsService } from './admin-global-subscriptions.service';
import type { ListAdminSubscriptionsQueryDto } from './dto';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '11111111-1111-4111-8111-111111111112';
const SCHOOL_C = '11111111-1111-4111-8111-111111111113';
const PLAN_A = '22222222-2222-4222-8222-222222222222';
const PLAN_B = '22222222-2222-4222-8222-222222222223';

type Row = Record<string, unknown>;

function makeSchoolsRepo(rows: Row[]) {
  return {
    findAll: async ({ where = {} }: { where: Row }) => {
      const orRows = (where as Record<PropertyKey, unknown>)[Op.or] as Row[] | undefined;
      const pattern = orRows?.map((sub) =>
        Object.values(sub).map((value) =>
          String(
            ((value as Record<PropertyKey, unknown>)[Op.iLike] as string) ?? value,
          ).replace(/^%|%$/g, ''),
        ),
      );
      return rows.filter((row) => {
        if (pattern && pattern.length > 0) {
          return pattern.some((terms) =>
            terms.some((term) => Object.values(row).some((v) => String(v).toLowerCase().includes(term.toLowerCase()))),
          );
        }
        return true;
      }) as never;
    },
  };
}

function makeSubscriptionsRepo(rows: Row[]) {
  return {
    findAll: async ({ where, order = [['created_at', 'DESC']] }: { where: Row; order: Array<[string, string]> }) => {
      const ids = ((where.school_id as Record<PropertyKey, unknown>)[Op.in] as string[]) ?? [];
      const filtered = rows.filter((row) => ids.includes(String(row.school_id)));
      return [...filtered].sort((a, b) => {
        for (const [column, direction] of order) {
          const av = a[column] as never;
          const bv = b[column] as never;
          if (av === bv) continue;
          return (av < bv ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
        }
        return 0;
      }) as never;
    },
  };
}

function makePlansRepo(rows: Row[]) {
  return {
    findAll: async ({ where }: { where: Row }) => {
      const ids = ((where?.id as Record<PropertyKey, unknown> | undefined)?.[Op.in] as string[] | undefined) ?? [];
      return rows.filter((row) => ids.includes(String(row.id))) as never;
    },
  };
}

function makeRawRepo(rows: Row[]) {
  return {
    findAll: async () => rows as never,
  };
}

function plan(overrides: Row = {}): Row {
  return {
    id: PLAN_A,
    code: 'pro',
    name: 'Pro',
    price_cents: 4900,
    currency: 'USD',
    billing_period: PlanBillingPeriod.MONTHLY,
    is_active: true,
    features: {},
    limits: { students: { unlimited: false, value: 500 } },
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function subscription(overrides: Row = {}): Row {
  return {
    id: 'sub-1',
    school_id: SCHOOL_A,
    plan_id: PLAN_A,
    status: SubscriptionStatus.ACTIVE,
    trial_start: null,
    trial_end: null,
    current_period_start: new Date('2026-01-01T00:00:00.000Z'),
    current_period_end: null,
    cancelled_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService(withSchoolRows: Row[] = [], withSubRows: Row[] = []) {
  const service = new AdminGlobalSubscriptionsService(
    makeSubscriptionsRepo(withSubRows) as never,
    makeSchoolsRepo(withSchoolRows) as never,
    makePlansRepo([plan(), plan({ id: PLAN_B, code: 'ent', name: 'Enterprise', price_cents: 120000, billing_period: PlanBillingPeriod.YEARLY })]) as never,
    makeRawRepo([
      { school_id: SCHOOL_A, role: UserRole.DRIVER },
      { school_id: SCHOOL_A, role: UserRole.CONDUCTOR },
      { school_id: SCHOOL_A, role: UserRole.PARENT },
      { school_id: SCHOOL_B, role: UserRole.DRIVER },
    ]) as never,
    makeRawRepo([{ school_id: SCHOOL_A }, { school_id: SCHOOL_A }, { school_id: SCHOOL_B }]) as never,
    makeRawRepo([{ school_id: SCHOOL_A }]) as never,
    makeRawRepo([{ school_id: SCHOOL_A }, { school_id: SCHOOL_B }]) as never,
    makeRawRepo([{ school_id: SCHOOL_A }]) as never,
    makeRawRepo([{ school_id: SCHOOL_A }, { school_id: SCHOOL_B }]) as never,
  );
  return service;
}

const SCHOOLS = [
  { id: SCHOOL_A, name: 'Lincoln High', code: 'lincoln', subdomain: 'lincoln', city: 'Springfield', is_active: true },
  { id: SCHOOL_B, name: 'Roosevelt Middle', code: 'roosevelt', subdomain: 'roosevelt', city: 'Riverdale', is_active: true },
  { id: SCHOOL_C, name: 'Grant Elementary', code: 'grant', subdomain: 'grant', city: 'Oakwood', is_active: false },
];

const QB: ListAdminSubscriptionsQueryDto = { page: 1, limit: 20 };

describe('AdminGlobalSubscriptionsService', () => {
  it('lists every school with its current/latest subscription, including none', async () => {
    const service = makeService(
      SCHOOLS,
      [
        subscription({ id: 'sub-a', school_id: SCHOOL_A, status: SubscriptionStatus.ACTIVE }),
        subscription({ id: 'sub-b', school_id: SCHOOL_B, status: SubscriptionStatus.CANCELLED }),
      ],
    );
    const result = await service.findAll({ ...QB, limit: 100 });
    assert.equal(result.meta.total, 3);
    assert.equal(result.items.length, 3);

    const a = result.items.find((item) => item.school_id === SCHOOL_A);
    assert.ok(a);
    assert.equal(a.status, SubscriptionStatus.ACTIVE);
    assert.equal(a.plan?.code, 'pro');
    assert.equal(a.subscription_id, 'sub-a');
    assert.notEqual(a.is_current, false);

    const c = result.items.find((item) => item.school_id === SCHOOL_C);
    assert.ok(c);
    assert.equal(c.status, SubscriptionStatus.NONE);
    assert.equal(c.plan, null);
    assert.deepEqual(c.limits, {});
  });

  it('prefers a live subscription over a newer historical row for the same school', async () => {
    const service = makeService(
      SCHOOLS,
      [
        subscription({ id: 'old', school_id: SCHOOL_B, status: SubscriptionStatus.EXPIRED, created_at: new Date('2026-02-01T00:00:00.000Z') }),
        subscription({ id: 'live', school_id: SCHOOL_B, status: SubscriptionStatus.PAST_DUE, created_at: new Date('2026-03-01T00:00:00.000Z') }),
      ],
    );
    const result = await service.findAll(QB);
    const b = result.items.find((item) => item.school_id === SCHOOL_B);
    assert.ok(b);
    assert.equal(b.subscription_id, 'live');
    assert.equal(b.status, SubscriptionStatus.PAST_DUE);
    assert.equal(b.is_current, true);
  });

  it('filters by search and by status', async () => {
    const service = makeService(SCHOOLS, [subscription({ school_id: SCHOOL_A })]);
    const search = await service.findAll({ ...QB, search: 'roosevelt' });
    assert.equal(search.meta.total, 1);
    assert.equal(search.items[0].school_id, SCHOOL_B);

    const none = await service.findAll({ ...QB, status: SubscriptionStatus.NONE });
    assert.equal(none.meta.total, 2);
    assert.equal(none.items.some((item) => item.school_id === SCHOOL_A), false);

    const active = await service.findAll({ ...QB, status: SubscriptionStatus.ACTIVE });
    assert.equal(active.meta.total, 1);
    assert.equal(active.items[0].school_id, SCHOOL_A);
  });

  it('filters by plan and reports usage against plan limits', async () => {
    const service = makeService(SCHOOLS, [subscription({ school_id: SCHOOL_A })]);
    const result = await service.findAll({ ...QB, plan_id: PLAN_A });
    assert.equal(result.meta.total, 1);
    const item = result.items[0];
    assert.deepEqual(item.usage, {
      students: 2,
      buses: 1,
      routes: 1,
      stops: 1,
      drivers: 1,
      conductors: 1,
      staff: 2,
      parents: 1,
      trips: 1,
    });
    assert.deepEqual(item.limits, { students: { unlimited: false, value: 500 } });
  });

  it('paginates the global list', async () => {
    const service = makeService(SCHOOLS, [subscription({ school_id: SCHOOL_A }), subscription({ school_id: SCHOOL_B })]);
    const page = await service.findAll({ ...QB, page: 1, limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.meta.total, 3);
    assert.equal(page.meta.hasNextPage, true);
    const page2 = await service.findAll({ ...QB, page: 2, limit: 1 });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.meta.hasPreviousPage, true);
  });
});
