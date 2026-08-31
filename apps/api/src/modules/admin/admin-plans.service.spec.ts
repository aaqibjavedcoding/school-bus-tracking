import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  PlanBillingPeriod,
  PlanFeature,
  PlanLimitResource,
} from '@school-bus-tracking/shared-types';
import { AdminPlansService } from './admin-plans.service';
import { PLAN_CODE_TAKEN_MESSAGE, PLAN_NOT_FOUND_MESSAGE } from './admin-plans.constants';
import type { ListAdminPlansQueryDto } from './dto';

/** Minimal in-memory Plan repository stub supporting the Op.iLike / Op.or shapes
 *  produced by `AdminPlansService`. */

type WhereValue = unknown;

function makePlansRepo(initial: Array<Record<string, unknown>> = []) {
  const rows = [...initial];
  return {
    rows,
    repo: {
      Op,
      findAndCountAll: async ({
        where,
        limit,
        offset,
        order,
      }: {
        where?: Record<string, unknown>;
        limit?: number;
        offset?: number;
        order?: Array<[string, string]>;
      } = {}) => {
        const filtered = rows.filter((row) => matchWhere(row, where ?? {}));
        const sorted = [...filtered].sort((a, b) => {
          for (const [column, dir] of order ?? [['created_at', 'DESC']]) {
            const av = a[column];
            const bv = b[column];
            if (av === bv) continue;
            return (av! < bv! ? -1 : 1) * (dir === 'ASC' ? 1 : -1);
          }
          return 0;
        });
        const page = sorted.slice(offset ?? 0, (offset ?? 0) + (limit ?? sorted.length));
        return { rows: page as never, count: filtered.length };
      },
      findOne: async ({ where }: { where: Record<string, unknown> }) => {
        const row = rows.find((r) => matchWhere(r, where));
        return (row ?? null) as never;
      },
      create: async (payload: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          id: `plan-${rows.length + 1}`,
          created_at: new Date('2026-02-01T00:00:00.000Z'),
          updated_at: new Date('2026-02-01T00:00:00.000Z'),
          deleted_at: null,
          is_active: true,
          features: {},
          limits: {},
          ...payload,
        };
        if (row.code) {
          const clash = rows.find((r) => r.code === row.code && r.deleted_at === null);
          if (clash) {
            throw new UniqueConstraintError({ message: 'duplicate', errors: [] });
          }
        }
        rows.push(row);
        return row as never;
      },
    },
  };
}

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (isPlainObject(value) && Op.or in (value as object)) {
      const clauses = (value as { [Op.or]?: unknown[] })[Op.or];
      if (!Array.isArray(clauses) || clauses.length === 0) return false;
      const any = clauses.some((clause) =>
        isPlainObject(clause)
          ? Object.entries(clause as Record<string, unknown>).every(([col, matcher]) =>
              matchPredicate(row[col], matcher),
            )
          : false,
      );
      if (!any) return false;
      continue;
    }
    if (!matchPredicate(row[key], value as WhereValue)) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function matchPredicate(actual: unknown, matcher: unknown): boolean {
  if (matcher === null) return actual === null;
  if (isPlainObject(matcher)) {
    if (Op.iLike in matcher) {
      const pattern = String((matcher as { [Op.iLike]: unknown })[Op.iLike]);
      const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
      return String(actual ?? '').toLowerCase().includes(needle);
    }
    if (Op.gte in matcher) return Number(actual) >= Number((matcher as { [Op.gte]: unknown })[Op.gte]);
    // Other operators not used by the service.
    return false;
  }
  return actual === matcher;
}

describe('AdminPlansService', () => {
  it('creates a plan with code, name, features and unlimited limits', async () => {
    const plansRepo = makePlansRepo([]);
    const service = new AdminPlansService(plansRepo.repo as never);

    const created = await service.create({
      code: 'basic',
      name: 'Basic',
      description: 'Starter tier',
      price: 19.99,
      currency: 'usd',
      billing_period: PlanBillingPeriod.MONTHLY,
      features: {
        [PlanFeature.LIVE_TRACKING]: true,
        [PlanFeature.ATTENDANCE]: true,
      },
      limits: {
        [PlanLimitResource.STUDENTS]: { unlimited: false, value: 300 },
        [PlanLimitResource.BUSES]: { unlimited: true, value: null },
      },
    });

    assert.equal(created.code, 'basic');
    assert.equal(created.name, 'Basic');
    assert.equal(created.currency, 'USD');
    assert.equal(created.price, '19.99');
    assert.equal(created.billing_period, PlanBillingPeriod.MONTHLY);
    assert.equal(created.is_active, true);
    assert.equal(created.features.live_tracking, true);
    assert.equal(created.features.attendance, true);
    assert.equal(created.features.analytics, undefined);
    assert.equal(created.limits.students?.unlimited, false);
    assert.equal(created.limits.students?.value, 300);
    assert.equal(created.limits.buses?.unlimited, true);
    assert.equal(created.limits.buses?.value, null);
  });

  it('rejects duplicate plan codes with a ConflictException', async () => {
    const plansRepo = makePlansRepo([
      {
        id: 'existing',
        code: 'pro',
        name: 'Pro',
        price_cents: 4900,
        currency: 'USD',
        billing_period: 'monthly',
        is_active: true,
        features: {},
        limits: {},
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
    ]);
    const service = new AdminPlansService(plansRepo.repo as never);

    await assert.rejects(
      service.create({
        code: 'pro',
        name: 'Professional',
        price: 49,
        currency: 'USD',
        billing_period: PlanBillingPeriod.MONTHLY,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.message, PLAN_CODE_TAKEN_MESSAGE);
        return true;
      },
    );
  });

  it('rejects an unknown feature key', async () => {
    const plansRepo = makePlansRepo([]);
    const service = new AdminPlansService(plansRepo.repo as never);

    await assert.rejects(
      service.create({
        code: 'x',
        name: 'X',
        price: 0,
        currency: 'USD',
        billing_period: PlanBillingPeriod.MONTHLY,
        features: { not_a_real_feature: true } as never,
      }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects a limit entry with unlimited=false and value=null', async () => {
    const plansRepo = makePlansRepo([]);
    const service = new AdminPlansService(plansRepo.repo as never);

    await assert.rejects(
      service.create({
        code: 'y',
        name: 'Y',
        price: 0,
        currency: 'USD',
        billing_period: PlanBillingPeriod.MONTHLY,
        limits: {
          [PlanLimitResource.STUDENTS]: { unlimited: false, value: null },
        },
      }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects an empty PATCH body', async () => {
    const plansRepo = makePlansRepo([
      makePlanRow('p1', { code: 'basic', name: 'Basic' }),
    ]);
    const service = new AdminPlansService(plansRepo.repo as never);
    await assert.rejects(service.update('p1', {}), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      return true;
    });
  });

  it('findOneOrThrow throws 404 for an unknown plan', async () => {
    const plansRepo = makePlansRepo([]);
    const service = new AdminPlansService(plansRepo.repo as never);
    await assert.rejects(service.findOneOrThrow('missing'), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, PLAN_NOT_FOUND_MESSAGE);
      return true;
    });
  });

  it('activates and deactivates the is_active flag; reversible', async () => {
    const plansRepo = makePlansRepo([
      makePlanRow('p1', { code: 'basic', name: 'Basic', is_active: true }),
    ]);
    const service = new AdminPlansService(plansRepo.repo as never);

    const deactivated = await service.deactivate('p1');
    assert.equal(deactivated.is_active, false);
    assert.equal(deactivated.status, 'inactive');
    assert.equal((plansRepo.rows[0] as { is_active: boolean }).is_active, false);

    const activated = await service.activate('p1');
    assert.equal(activated.is_active, true);
    assert.equal(activated.status, 'active');
  });

  it('findAll maps the status filter to is_active and returns summaries', async () => {
    const plansRepo = makePlansRepo([
      makePlanRow('a', {
        code: 'basic',
        name: 'Basic',
        price_cents: 1900,
        is_active: true,
        features: { [PlanFeature.LIVE_TRACKING]: true },
        limits: {
          [PlanLimitResource.STUDENTS]: { unlimited: false, value: 300 },
        },
      }),
      makePlanRow('b', {
        code: 'pro',
        name: 'Pro',
        price_cents: 4900,
        is_active: false,
        features: { [PlanFeature.LIVE_TRACKING]: true, [PlanFeature.ANALYTICS]: true },
        limits: {
          [PlanLimitResource.STUDENTS]: { unlimited: true, value: null },
        },
      }),
    ]);
    const service = new AdminPlansService(plansRepo.repo as never);

    const query = { page: 1, limit: 10, status: 'inactive' } as unknown as ListAdminPlansQueryDto;
    const result = await service.findAll(query);
    assert.equal(result.meta.total, 1);
    assert.equal(result.items[0].code, 'pro');
    assert.equal(result.items[0].status, 'inactive');
    // Feature summary lists human-readable labels of enabled features.
    assert.ok(result.items[0].feature_summary.length > 0);
    assert.ok(result.items[0].feature_summary.some((label: string) => label.includes('Analytics')));
    assert.equal(result.items[0].features.analytics, true);
    assert.equal(result.items[0].limit_summary[0].display, 'Unlimited');
  });

  it('updates price and returns cents converted back to decimal string', async () => {
    const plansRepo = makePlansRepo([
      makePlanRow('p1', { code: 'basic', name: 'Basic', price_cents: 1900, currency: 'USD' }),
    ]);
    const service = new AdminPlansService(plansRepo.repo as never);

    const updated = await service.update('p1', { price: 29.5 });
    assert.equal(updated.price, '29.50');
  });

  it('never exposes credentials: serialized response has no password/price_cents fields', async () => {
    const plansRepo = makePlansRepo([
      makePlanRow('p1', {
        code: 'basic',
        name: 'Basic',
        price_cents: 1900,
        currency: 'USD',
        features: { [PlanFeature.LIVE_TRACKING]: true },
      }),
    ]);
    const service = new AdminPlansService(plansRepo.repo as never);
    const plan = await service.findOneOrThrow('p1');
    const serialized = JSON.stringify(plan);
    assert.ok(!serialized.includes('price_cents'));
    assert.ok(!serialized.includes('password'));
    assert.ok(serialized.includes('"price":"19.00"'));
  });
});

function makePlanRow(id: string, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    code: 'basic',
    name: 'Basic',
    description: null,
    price_cents: 0,
    currency: 'USD',
    billing_period: 'monthly',
    is_active: true,
    features: {},
    limits: {},
    created_at: new Date('2026-02-01T00:00:00.000Z'),
    updated_at: new Date('2026-02-01T00:00:00.000Z'),
    deleted_at: null,
    async update(this: Record<string, unknown>, patch2: Record<string, unknown>) {
      Object.assign(this, patch2);
    },
    async reload() {
      return this;
    },
    ...patch,
  };
}
