import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  PlanBillingPeriod,
  SubscriptionStatus,
} from '@school-bus-tracking/shared-types';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  SUBSCRIPTION_ALREADY_EXISTS_MESSAGE,
  SUBSCRIPTION_NOT_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_CANCELLABLE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_PLAN_INACTIVE_MESSAGE,
} from './admin-subscriptions.constants';
import { PLAN_NOT_FOUND_MESSAGE } from './admin-plans.constants';
import { SCHOOL_NOT_FOUND_MESSAGE } from './admin.constants';

/**
 * Unit suite for the Task 42 school-subscription foundation.
 *
 * The repositories are Sequelize-shaped in-memory stubs (same approach as the
 * plans/schools suites): they honour the `where` / `order` / `Op.in` shapes
 * the service actually produces, so the business rules are exercised for real
 * without a PostgreSQL instance.
 */

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SCHOOL_ID = '11111111-1111-4111-8111-111111111112';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_B_ID = '22222222-2222-4222-8222-222222222223';
const INACTIVE_PLAN_ID = '22222222-2222-4222-8222-222222222224';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

type Row = Record<string, unknown>;

function makeSchoolsRepo(ids: string[] = [SCHOOL_ID, OTHER_SCHOOL_ID]) {
  return {
    findOne: async ({ where }: { where: Row }) =>
      (ids.includes(String(where.id)) ? { id: where.id } : null) as never,
  };
}

function planRow(overrides: Row = {}): Row {
  return {
    id: PLAN_ID,
    code: 'pro',
    name: 'Pro',
    description: 'Pro tier',
    price_cents: 4900,
    currency: 'USD',
    billing_period: PlanBillingPeriod.MONTHLY,
    is_active: true,
    features: { live_tracking: true },
    limits: { students: { unlimited: false, value: 500 } },
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makePlansRepo(rows: Row[] = [planRow()]) {
  return {
    rows,
    repo: {
      findOne: async ({ where }: { where: Row }) =>
        (rows.find((row) => row.id === where.id) ?? null) as never,
      findAll: async ({ where }: { where?: Row } = {}) => {
        const idClause = where?.id as { [Op.in]?: string[] } | undefined;
        const ids = idClause?.[Op.in];
        return (ids ? rows.filter((row) => ids.includes(String(row.id))) : rows) as never;
      },
    },
  };
}

/** In-memory `school_subscriptions` table with the live-uniqueness backstop. */
function makeSubscriptionsRepo(initial: Row[] = [], options: { enforceUnique?: boolean } = {}) {
  const rows: Row[] = [];
  let seq = 0;

  const attach = (row: Row): Row => {
    row.update = async (patch: Row) => {
      Object.assign(row, patch, { updated_at: new Date() });
      return row;
    };
    return row;
  };

  const insert = (payload: Row): Row => {
    seq += 1;
    const row: Row = attach({
      id: `sub-${seq}`,
      status: SubscriptionStatus.ACTIVE,
      trial_start: null,
      trial_end: null,
      current_period_start: new Date('2026-01-01T00:00:00.000Z'),
      current_period_end: null,
      cancelled_at: null,
      created_at: new Date(Date.now() + seq),
      updated_at: new Date(Date.now() + seq),
      deleted_at: null,
      ...payload,
    });
    rows.push(row);
    return row;
  };

  for (const row of initial) insert(row);

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && Op.in in (value as object)) {
        const list = (value as { [Op.in]: unknown[] })[Op.in];
        return list.includes(row[key]);
      }
      return row[key] === value;
    });

  const sort = (list: Row[], order?: Array<[string, string]>): Row[] =>
    [...list].sort((a, b) => {
      for (const [column, direction] of order ?? [['created_at', 'DESC']]) {
        const av = a[column] as never;
        const bv = b[column] as never;
        if (av === bv) continue;
        return (av < bv ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
      }
      return 0;
    });

  return {
    rows,
    repo: {
      sequelize: {
        transaction: async (cb: (t: unknown) => Promise<unknown>) => cb({}),
      },
      findOne: async ({ where, order }: { where: Row; order?: Array<[string, string]> }) =>
        (sort(
          rows.filter((row) => matches(row, where)),
          order,
        )[0] ?? null) as never,
      findAll: async ({ where, order }: { where?: Row; order?: Array<[string, string]> } = {}) =>
        sort(where ? rows.filter((row) => matches(row, where)) : rows, order) as never,
      create: async (payload: Row) => {
        if (options.enforceUnique !== false) {
          const clash = rows.find(
            (row) =>
              row.school_id === payload.school_id &&
              LIVE_SUBSCRIPTION_STATUS_VALUES.includes(row.status as never) &&
              LIVE_SUBSCRIPTION_STATUS_VALUES.includes(
                (payload.status ?? SubscriptionStatus.ACTIVE) as never,
              ),
          );
          if (clash) {
            throw new UniqueConstraintError({ message: 'duplicate live subscription', errors: [] });
          }
        }
        return insert(payload) as never;
      },
    },
  };
}

function makeService(
  subscriptions = makeSubscriptionsRepo(),
  plans = makePlansRepo(),
  schools = makeSchoolsRepo(),
) {
  return {
    service: new AdminSubscriptionsService(
      subscriptions.repo as never,
      schools as never,
      plans.repo as never,
    ),
    subscriptions,
    plans,
  };
}

describe('AdminSubscriptionsService — reads', () => {
  it('returns a clean `none` state for a school without a subscription', async () => {
    const { service } = makeService();

    const result = await service.getSubscription(SCHOOL_ID);

    assert.equal(result.status, SubscriptionStatus.NONE);
    assert.equal(result.id, null);
    assert.equal(result.school_id, SCHOOL_ID);
    assert.equal(result.plan, null);
    assert.equal(result.plan_id, null);
    assert.equal(result.price, null);
    assert.equal(result.billing_period, null);
    assert.equal(result.current_period_end, null);
    assert.equal(result.cancelled_at, null);
  });

  it('reports the legacy `none` info block for the school console projections', async () => {
    const { service } = makeService();

    assert.deepEqual(await service.getSubscriptionInfo(SCHOOL_ID), {
      status: 'none',
      plan: null,
      current_period_end: null,
    });

    const bulk = await service.getSubscriptionInfoForSchools([SCHOOL_ID, OTHER_SCHOOL_ID]);
    assert.equal(bulk.size, 0);
  });

  it('rejects a read for a school that does not exist', async () => {
    const { service } = makeService();
    await assert.rejects(service.getSubscription(MISSING_ID), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error as NotFoundException).message, SCHOOL_NOT_FOUND_MESSAGE);
      return true;
    });
  });
});

describe('AdminSubscriptionsService — create', () => {
  it('assigns an active plan to a school and exposes the plan relationship', async () => {
    const { service, subscriptions } = makeService();

    const created = await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    assert.equal(created.status, SubscriptionStatus.ACTIVE);
    assert.equal(created.school_id, SCHOOL_ID);
    assert.equal(created.plan_id, PLAN_ID);
    // Plan data is resolved through the relationship, never copied.
    assert.equal(created.plan?.code, 'pro');
    assert.equal(created.plan?.name, 'Pro');
    assert.equal(created.price, '49.00');
    assert.equal(created.currency, 'USD');
    assert.equal(created.billing_period, PlanBillingPeriod.MONTHLY);
    assert.ok(created.current_period_start);
    assert.equal(created.current_period_end, null);
    assert.equal(created.cancelled_at, null);

    // The stored row carries only the relationship + lifecycle columns.
    const stored = subscriptions.rows[0];
    assert.equal(stored.plan_id, PLAN_ID);
    assert.equal(stored.name, undefined);
    assert.equal(stored.code, undefined);
    assert.equal(stored.price_cents, undefined);
    assert.equal(stored.features, undefined);
    assert.equal(stored.limits, undefined);
  });

  it('derives a trialing subscription from the supplied trial window', async () => {
    const { service } = makeService();

    const created = await service.createSubscription(SCHOOL_ID, {
      plan_id: PLAN_ID,
      trial_start: '2026-03-01T00:00:00.000Z',
      trial_end: '2026-03-15T00:00:00.000Z',
    });

    assert.equal(created.status, SubscriptionStatus.TRIALING);
    assert.equal(created.trial_start, '2026-03-01T00:00:00.000Z');
    assert.equal(created.trial_end, '2026-03-15T00:00:00.000Z');
    assert.equal(created.current_period_start, '2026-03-01T00:00:00.000Z');
  });

  it('rejects an unknown school (a subscription must belong to a real school)', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(MISSING_ID, { plan_id: PLAN_ID }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).message, SCHOOL_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('rejects an unknown plan', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, { plan_id: MISSING_ID }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).message, PLAN_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('rejects a deactivated plan — retired plans are not sold again', async () => {
    const plans = makePlansRepo([
      planRow(),
      planRow({ id: INACTIVE_PLAN_ID, code: 'legacy', name: 'Legacy', is_active: false }),
    ]);
    const { service } = makeService(makeSubscriptionsRepo(), plans);

    await assert.rejects(
      service.createSubscription(SCHOOL_ID, { plan_id: INACTIVE_PLAN_ID }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error as ConflictException).message, SUBSCRIPTION_PLAN_INACTIVE_MESSAGE);
        return true;
      },
    );
  });

  it('prevents a duplicate live subscription for the same school', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    await assert.rejects(
      service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error as ConflictException).message, SUBSCRIPTION_ALREADY_EXISTS_MESSAGE);
        return true;
      },
    );
  });

  it('maps the unique-index violation of a concurrent create onto a 409', async () => {
    // The service-level guard is bypassed by making the pre-check blind, which
    // is exactly the race the partial unique index protects against.
    const subscriptions = makeSubscriptionsRepo([
      { school_id: SCHOOL_ID, plan_id: PLAN_ID, status: SubscriptionStatus.ACTIVE },
    ]);
    const original = subscriptions.repo.findOne;
    subscriptions.repo.findOne = (async () => null) as never;
    const { service } = makeService(subscriptions);

    await assert.rejects(
      service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error as ConflictException).message, SUBSCRIPTION_ALREADY_EXISTS_MESSAGE);
        return true;
      },
    );
    subscriptions.repo.findOne = original;
  });

  it('allows a second school to subscribe to the same plan', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
    const other = await service.createSubscription(OTHER_SCHOOL_ID, { plan_id: PLAN_ID });
    assert.equal(other.school_id, OTHER_SCHOOL_ID);
    assert.equal(other.plan_id, PLAN_ID);
  });

  it('rejects the projection-only `none` status', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        status: SubscriptionStatus.NONE,
      }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects a terminal status at creation time', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        status: SubscriptionStatus.CANCELLED,
      }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects trial_end before trial_start', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        trial_start: '2026-04-10T00:00:00.000Z',
        trial_end: '2026-04-01T00:00:00.000Z',
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = (error as BadRequestException).getResponse() as {
          details?: Record<string, string>;
        };
        assert.match(String(body.details?.trial_end), /trial_end cannot be before trial_start/);
        return true;
      },
    );
  });

  it('rejects a trialing subscription without a trial end', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        status: SubscriptionStatus.TRIALING,
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        return true;
      },
    );
  });

  it('rejects current_period_end before current_period_start', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        current_period_start: '2026-05-01T00:00:00.000Z',
        current_period_end: '2026-04-01T00:00:00.000Z',
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = (error as BadRequestException).getResponse() as {
          details?: Record<string, string>;
        };
        assert.match(
          String(body.details?.current_period_end),
          /current_period_end cannot be before current_period_start/,
        );
        return true;
      },
    );
  });

  it('rejects an unparsable date', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createSubscription(SCHOOL_ID, {
        plan_id: PLAN_ID,
        current_period_start: 'not-a-date',
      }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});

describe('AdminSubscriptionsService — change', () => {
  it('changes the plan by superseding the previous subscription (history kept)', async () => {
    const plans = makePlansRepo([
      planRow(),
      planRow({ id: PLAN_B_ID, code: 'enterprise', name: 'Enterprise', price_cents: 99900 }),
    ]);
    const { service, subscriptions } = makeService(makeSubscriptionsRepo(), plans);
    const first = await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    const changed = await service.updateSubscription(SCHOOL_ID, { plan_id: PLAN_B_ID });

    assert.notEqual(changed.id, first.id);
    assert.equal(changed.plan_id, PLAN_B_ID);
    assert.equal(changed.plan?.code, 'enterprise');
    assert.equal(changed.status, SubscriptionStatus.ACTIVE);

    // Both rows still exist: nothing was deleted or overwritten.
    assert.equal(subscriptions.rows.length, 2);
    const previous = subscriptions.rows.find((row) => row.id === first.id)!;
    assert.equal(previous.status, SubscriptionStatus.EXPIRED);
    assert.equal(previous.plan_id, PLAN_ID);
    assert.ok(previous.current_period_end instanceof Date);

    // The read endpoint now reports the new subscription.
    const current = await service.getSubscription(SCHOOL_ID);
    assert.equal(current.plan_id, PLAN_B_ID);
  });

  it('rejects a plan change onto a deactivated plan', async () => {
    const plans = makePlansRepo([
      planRow(),
      planRow({ id: INACTIVE_PLAN_ID, code: 'legacy', name: 'Legacy', is_active: false }),
    ]);
    const { service } = makeService(makeSubscriptionsRepo(), plans);
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    await assert.rejects(
      service.updateSubscription(SCHOOL_ID, { plan_id: INACTIVE_PLAN_ID }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error as ConflictException).message, SUBSCRIPTION_PLAN_INACTIVE_MESSAGE);
        return true;
      },
    );
  });

  it('updates status and period dates in place when the plan is unchanged', async () => {
    const { service, subscriptions } = makeService();
    const created = await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    const updated = await service.updateSubscription(SCHOOL_ID, {
      status: SubscriptionStatus.PAST_DUE,
      current_period_end: '2026-12-31T00:00:00.000Z',
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.status, SubscriptionStatus.PAST_DUE);
    assert.equal(updated.current_period_end, '2026-12-31T00:00:00.000Z');
    assert.equal(subscriptions.rows.length, 1);
  });

  it('rejects an update with an invalid period window', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, {
      plan_id: PLAN_ID,
      current_period_start: '2026-06-01T00:00:00.000Z',
    });

    await assert.rejects(
      service.updateSubscription(SCHOOL_ID, { current_period_end: '2026-05-01T00:00:00.000Z' }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects an update for a school with no subscription at all', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.updateSubscription(SCHOOL_ID, { status: SubscriptionStatus.ACTIVE }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).message, SUBSCRIPTION_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('rejects an update when the only subscription is already terminal', async () => {
    const subscriptions = makeSubscriptionsRepo([
      {
        school_id: SCHOOL_ID,
        plan_id: PLAN_ID,
        status: SubscriptionStatus.CANCELLED,
        cancelled_at: new Date('2026-02-01T00:00:00.000Z'),
      },
    ]);
    const { service } = makeService(subscriptions);

    await assert.rejects(
      service.updateSubscription(SCHOOL_ID, { status: SubscriptionStatus.ACTIVE }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal((error as ConflictException).message, SUBSCRIPTION_NOT_ACTIVE_MESSAGE);
        return true;
      },
    );
  });

  it('rejects an empty update body', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
    await assert.rejects(
      service.updateSubscription(SCHOOL_ID, {}),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});

describe('AdminSubscriptionsService — cancel', () => {
  it('cancels the live subscription and preserves the record', async () => {
    const { service, subscriptions } = makeService();
    const created = await service.createSubscription(SCHOOL_ID, {
      plan_id: PLAN_ID,
      current_period_start: '2026-06-01T00:00:00.000Z',
    });

    const cancelled = await service.cancelSubscription(SCHOOL_ID, {
      cancelled_at: '2026-07-01T00:00:00.000Z',
    });

    assert.equal(cancelled.id, created.id);
    assert.equal(cancelled.status, SubscriptionStatus.CANCELLED);
    assert.equal(cancelled.cancelled_at, '2026-07-01T00:00:00.000Z');
    // The row survives cancellation — history, not deletion.
    assert.equal(subscriptions.rows.length, 1);
    assert.equal(subscriptions.rows[0].status, SubscriptionStatus.CANCELLED);

    // The cancelled subscription (with its date) remains readable.
    const after = await service.getSubscription(SCHOOL_ID);
    assert.equal(after.status, SubscriptionStatus.CANCELLED);
    assert.equal(after.cancelled_at, '2026-07-01T00:00:00.000Z');
    assert.equal(after.plan?.code, 'pro');
  });

  it('defaults the cancellation timestamp to now', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    const cancelled = await service.cancelSubscription(SCHOOL_ID);

    assert.equal(cancelled.status, SubscriptionStatus.CANCELLED);
    assert.ok(cancelled.cancelled_at);
    assert.ok(!Number.isNaN(Date.parse(cancelled.cancelled_at as string)));
  });

  it('rejects a cancellation date before the current period start', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, {
      plan_id: PLAN_ID,
      current_period_start: '2026-08-01T00:00:00.000Z',
    });

    await assert.rejects(
      service.cancelSubscription(SCHOOL_ID, { cancelled_at: '2026-07-01T00:00:00.000Z' }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = (error as BadRequestException).getResponse() as {
          details?: Record<string, string>;
        };
        assert.match(String(body.details?.cancelled_at), /cannot be before/);
        return true;
      },
    );
  });

  it('rejects cancelling twice', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
    await service.cancelSubscription(SCHOOL_ID);

    await assert.rejects(service.cancelSubscription(SCHOOL_ID), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error as ConflictException).message, SUBSCRIPTION_NOT_CANCELLABLE_MESSAGE);
      return true;
    });
  });

  it('rejects cancelling when the school has no subscription', async () => {
    const { service } = makeService();
    await assert.rejects(service.cancelSubscription(SCHOOL_ID), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error as NotFoundException).message, SUBSCRIPTION_NOT_FOUND_MESSAGE);
      return true;
    });
  });

  it('rejects cancelling for a school that does not exist', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.cancelSubscription(MISSING_ID),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it('lets a school resubscribe after a cancellation, keeping both records', async () => {
    const { service, subscriptions } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
    await service.cancelSubscription(SCHOOL_ID);

    const resubscribed = await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    assert.equal(resubscribed.status, SubscriptionStatus.ACTIVE);
    assert.equal(subscriptions.rows.length, 2);
    assert.equal(subscriptions.rows[0].status, SubscriptionStatus.CANCELLED);
  });
});

describe('AdminSubscriptionsService — console projections', () => {
  it('exposes the live subscription with its plan reference for the school console', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, {
      plan_id: PLAN_ID,
      current_period_end: '2026-12-31T00:00:00.000Z',
    });

    const info = await service.getSubscriptionInfo(SCHOOL_ID);
    assert.equal(info.status, SubscriptionStatus.ACTIVE);
    assert.equal(info.plan?.code, 'pro');
    assert.equal(info.plan?.price, '49.00');
    assert.equal(info.plan?.billing_period, PlanBillingPeriod.MONTHLY);
    assert.equal(info.current_period_end, '2026-12-31T00:00:00.000Z');

    const bulk = await service.getSubscriptionInfoForSchools([SCHOOL_ID, OTHER_SCHOOL_ID]);
    assert.equal(bulk.size, 1);
    assert.equal(bulk.get(SCHOOL_ID)?.plan?.name, 'Pro');
    assert.equal(bulk.get(OTHER_SCHOOL_ID), undefined);
  });

  it('prefers the live subscription over older history in the bulk projection', async () => {
    const plans = makePlansRepo([
      planRow(),
      planRow({ id: PLAN_B_ID, code: 'enterprise', name: 'Enterprise', price_cents: 99900 }),
    ]);
    const { service } = makeService(makeSubscriptionsRepo(), plans);
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
    await service.updateSubscription(SCHOOL_ID, { plan_id: PLAN_B_ID });

    const bulk = await service.getSubscriptionInfoForSchools([SCHOOL_ID]);
    assert.equal(bulk.get(SCHOOL_ID)?.status, SubscriptionStatus.ACTIVE);
    assert.equal(bulk.get(SCHOOL_ID)?.plan?.code, 'enterprise');
  });
});

describe('AdminSubscriptionsService — history (Task 42, step 2)', () => {
  it('returns an empty list for a school without any subscription record', async () => {
    const { service } = makeService();

    const result = await service.getSubscriptionHistory(SCHOOL_ID);

    assert.deepEqual(result.items, []);
  });

  it('rejects history reads for a school that does not exist', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.getSubscriptionHistory(MISSING_ID),
      (error: unknown) =>
        error instanceof NotFoundException && /school/i.test((error as Error).message),
    );
  });

  it('returns every preserved record newest-first after change and cancel', async () => {
    const plans = makePlansRepo([
      planRow(),
      planRow({ id: PLAN_B_ID, code: 'enterprise', name: 'Enterprise', price_cents: 99900 }),
    ]);
    const { service } = makeService(makeSubscriptionsRepo(), plans);
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });
    await service.updateSubscription(SCHOOL_ID, { plan_id: PLAN_B_ID });
    await service.cancelSubscription(SCHOOL_ID);
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    const result = await service.getSubscriptionHistory(SCHOOL_ID);

    assert.equal(result.items.length, 3);
    // Newest first: live resubscription, cancelled enterprise, expired pro.
    assert.equal(result.items[0].status, SubscriptionStatus.ACTIVE);
    assert.equal(result.items[0].is_current, true);
    assert.equal(result.items[0].plan?.code, 'pro');
    assert.equal(result.items[1].status, SubscriptionStatus.CANCELLED);
    assert.equal(result.items[1].is_current, false);
    assert.ok(result.items[1].cancelled_at, 'cancellation timestamp preserved');
    assert.equal(result.items[1].plan?.code, 'enterprise');
    assert.equal(result.items[2].status, SubscriptionStatus.EXPIRED);
    assert.equal(result.items[2].is_current, false);
  });

  it('embeds only the compact plan reference — plan terms are never duplicated', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    const result = await service.getSubscriptionHistory(SCHOOL_ID);

    const plan = result.items[0].plan;
    assert.ok(plan);
    assert.equal(plan?.price, '49.00');
    assert.equal(plan?.billing_period, PlanBillingPeriod.MONTHLY);
    assert.equal('features' in (plan as object), false, 'no full plan payload per row');
  });

  it('marks a trialing subscription as current with its trial window intact', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, {
      plan_id: PLAN_ID,
      status: SubscriptionStatus.TRIALING,
      trial_start: '2026-03-01T00:00:00.000Z',
      trial_end: '2026-03-15T00:00:00.000Z',
    });

    const result = await service.getSubscriptionHistory(SCHOOL_ID);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, SubscriptionStatus.TRIALING);
    assert.equal(result.items[0].is_current, true);
    assert.equal(result.items[0].trial_start, '2026-03-01T00:00:00.000Z');
    assert.equal(result.items[0].trial_end, '2026-03-15T00:00:00.000Z');
  });

  it('does not mix the history of different schools', async () => {
    const { service } = makeService();
    await service.createSubscription(SCHOOL_ID, { plan_id: PLAN_ID });

    const other = await service.getSubscriptionHistory(OTHER_SCHOOL_ID);

    assert.deepEqual(other.items, []);
  });
});
