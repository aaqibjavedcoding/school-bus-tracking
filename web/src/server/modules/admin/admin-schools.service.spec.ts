import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '../../framework';
import {
  PlanBillingPeriod,
  SubscriptionStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import type { AdminSchoolSubscriptionInfo } from '@school-bus-tracking/shared-types';
import { AdminSchoolsService } from './admin-schools.service';
import { SchoolsService } from '../schools/schools.service';
import { SCHOOL_NOT_FOUND_MESSAGE } from './admin.constants';
import { NO_SUBSCRIPTION_INFO } from './admin-subscriptions.constants';
import type { ListAdminSchoolsQueryDto } from './dto';

/** Minimal shared stub helpers — the service only touches these surfaces. */

/**
 * Subscription-domain stub (Task 42). By default it reports the historical
 * `none` state, which is what a school without a subscription must keep
 * returning. Tests that care about a real subscription pass their own map.
 */
function makeSubscriptionsStub(infoBySchool: Record<string, AdminSchoolSubscriptionInfo> = {}) {
  return {
    getSubscriptionInfo: async (schoolId: string): Promise<AdminSchoolSubscriptionInfo> =>
      infoBySchool[schoolId] ?? { ...NO_SUBSCRIPTION_INFO },
    getSubscriptionInfoForSchools: async (
      schoolIds: string[],
    ): Promise<Map<string, AdminSchoolSubscriptionInfo>> => {
      const map = new Map<string, AdminSchoolSubscriptionInfo>();
      for (const id of schoolIds) {
        if (infoBySchool[id]) map.set(id, infoBySchool[id]);
      }
      return map;
    },
  };
}

/**
 * Stub for the stop / route-assignment repositories used by the School 360
 * resource overview: a grouped `findAll` that returns no rows.
 */
function emptyGroupedRepo() {
  return {
    sequelize: { fn: (name: string, col: unknown) => ({ fn: name, col }), col: (n: string) => n },
    findAll: async () => [] as never[],
  };
}

interface StubTransaction {
  state: 'active' | 'committed' | 'rolled-back';
}

function makeSchoolsRepo(initial: Array<Record<string, unknown>> = []) {
  const rows = [...initial];
  const calls: { updateArgs?: unknown[] } = {};
  return {
    rows,
    calls,
    repo: {
      sequelize: { transaction: null },
      findAndCountAll: async () => ({ rows: rows as never, count: rows.length }),
      findOne: async ({ where }: { where: Record<string, unknown> }) => {
        const row = rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
        return (row ?? null) as never;
      },
      create: async (payload: Record<string, unknown>) => {
        const row: Record<string, unknown> = {
          id: `school-${rows.length + 1}`,
          created_at: new Date('2026-02-01T00:00:00.000Z'),
          updated_at: new Date('2026-02-01T00:00:00.000Z'),
          is_active: true,
          ...payload,
        };
        rows.push(row);
        return row as never;
      },
    },
  };
}

describe('AdminSchoolsService.lifecycle', () => {
  it('activates and deactivates the school is_active flag; deactivation is reversible', async () => {
    const schoolId = '11111111-1111-4111-8111-111111111111';
    const schoolsRepo = makeSchoolsRepo([
      {
        id: schoolId,
        name: 'Lincoln High',
        code: 'lincoln',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        async update(this: Record<string, unknown>, patch: Record<string, unknown>) {
          Object.assign(this, patch);
        },
        async reload() {
          return this;
        },
      } as Record<string, unknown>,
    ]);

    const refreshUpdates: unknown[] = [];
    const refreshRepo = {
      update: async (_patch: unknown, options: unknown) => {
        refreshUpdates.push(options);
        return [1];
      },
    };
    const txRunner = async (cb: (tx: StubTransaction) => Promise<unknown>) =>
      cb({ state: 'active' });
    (schoolsRepo.repo as unknown as { sequelize: unknown }).sequelize = { transaction: txRunner };
    // give the school row a .sequelize reference for the deactivate transaction
    const school = schoolsRepo.rows[0] as unknown as { sequelize: unknown };
    school.sequelize = { transaction: txRunner };

    const onboarding = {
      provisionSchool: async () => {
        throw new Error('not used');
      },
    } as unknown as SchoolsService;

    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      refreshRepo as never,
      onboarding,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );

    const deactivated = await service.deactivate(schoolId);
    assert.equal(deactivated.is_active, false);
    assert.equal(deactivated.status, 'inactive');
    assert.equal((schoolsRepo.rows[0] as { is_active: boolean }).is_active, false);
    // Open refresh sessions for the tenant are revoked on deactivation.
    assert.equal(refreshUpdates.length, 1);

    const activated = await service.activate(schoolId);
    assert.equal(activated.is_active, true);
    assert.equal(activated.status, 'active');
    assert.equal((schoolsRepo.rows[0] as { is_active: boolean }).is_active, true);
  });

  it('throws 404 NotFound when the school does not exist', async () => {
    const schoolsRepo = makeSchoolsRepo([]);
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );
    await assert.rejects(
      service.deactivate('99999999-9999-4999-9999-999999999999'),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, SCHOOL_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('maps the query DTO status filter to an is_active predicate', async () => {
    let capturedWhere: Record<string, unknown> | undefined;
    const schoolsRepo = {
      repo: {
        findAndCountAll: async ({ where }: { where: Record<string, unknown> }) => {
          capturedWhere = where;
          return { rows: [] as never[], count: 0 };
        },
      },
    };
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      {} as never,
      { findAll: async () => [] } as never,
      { findAll: async () => [] } as never,
      { findAll: async () => [] } as never,
      { findAll: async () => [] } as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );

    const query = { page: 1, limit: 10, status: 'inactive' } as unknown as ListAdminSchoolsQueryDto;
    await service.findAll(query);
    assert.equal(capturedWhere?.is_active, false);

    const queryActive = {
      page: 1,
      limit: 10,
      status: 'active',
    } as unknown as ListAdminSchoolsQueryDto;
    await service.findAll(queryActive);
    assert.equal(capturedWhere?.is_active, true);
  });

  it('rejects an empty PATCH body with a bad request error', async () => {
    const schoolId = '11111111-1111-4111-8111-111111111111';
    const schoolsRepo = makeSchoolsRepo([
      { id: schoolId, code: 'lincoln', is_active: true } as Record<string, unknown>,
    ]);
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );
    await assert.rejects(
      service.update(schoolId, {}),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 400,
    );
  });

  it('never exposes credentials: the school response projection has no password fields', async () => {
    const schoolId = '11111111-1111-4111-8111-111111111111';
    const created = {
      id: schoolId,
      name: 'Lincoln High',
      code: 'lincoln',
      subdomain: null,
      email: 'office@lincoln.test',
      phone: null,
      address_line1: null,
      address_line2: null,
      city: 'Springfield',
      state: null,
      postal_code: null,
      country: 'US',
      timezone: 'UTC',
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const schoolsRepo = makeSchoolsRepo([created as unknown as Record<string, unknown>]);
    const sequelize = {
      fn: (name: string, col: unknown) => ({ fn: name, col }),
      col: (name: string) => name,
    };
    const usersRepo = {
      sequelize,
      findAll: async () =>
        [
          {
            id: 'u1',
            school_id: schoolId,
            role: UserRole.SCHOOL_ADMIN,
            first_name: 'Alicia',
            last_name: 'Adams',
            email: 'admin@lincoln.test',
            phone: null,
            is_active: true,
            email_verified_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ] as never[],
    };
    const groupedModel = { sequelize, findAll: async () => [] as never[] };
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      usersRepo as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );

    const details = await service.findOneOrThrow(schoolId);
    const serialized = JSON.stringify(details);
    assert.ok(!serialized.includes('password'));
    assert.ok(!serialized.includes('password_hash'));
    assert.equal(details.school.status, 'active');
    assert.equal(details.admins[0].email, 'admin@lincoln.test');
    assert.equal(details.subscription.status, 'none');
  });

  it('findOneOrThrow surfaces not-found for an unknown school', async () => {
    const schoolsRepo = makeSchoolsRepo([]);
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );
    await assert.rejects(service.findOneOrThrow('missing'), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      return true;
    });
  });

  it('update rejects a contact email already used by another school', async () => {
    const schoolsRepo = makeSchoolsRepo([
      { id: 'a', code: 'alpha', email: 'shared@x.test' },
      { id: 'b', code: 'beta', email: null },
    ] as unknown as Record<string, unknown>[]);
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );
    await assert.rejects(
      service.update('b', { email: 'shared@x.test' }),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('surfaces a real subscription in the school details projection (Task 42)', async () => {
    const schoolId = '33333333-3333-4333-8333-333333333333';
    const schoolsRepo = makeSchoolsRepo([
      {
        id: schoolId,
        name: 'Riverside',
        code: 'riverside',
        subdomain: null,
        email: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
        timezone: 'UTC',
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as unknown as Record<string, unknown>[]);
    const sequelize = { fn: (name: string, col: unknown) => ({ fn: name, col }), col: (n: string) => n };
    const groupedModel = { sequelize, findAll: async () => [] as never[] };
    const subscription: AdminSchoolSubscriptionInfo = {
      status: SubscriptionStatus.ACTIVE,
      plan: {
        id: '44444444-4444-4444-8444-444444444444',
        code: 'pro',
        name: 'Pro',
        price: '49.00',
        currency: 'USD',
        billing_period: PlanBillingPeriod.MONTHLY,
        is_active: true,
      },
      current_period_end: '2026-12-31T00:00:00.000Z',
    };
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub({ [schoolId]: subscription }) as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );

    const details = await service.findOneOrThrow(schoolId);
    assert.equal(details.subscription.status, SubscriptionStatus.ACTIVE);
    assert.equal(details.subscription.plan?.code, 'pro');
    assert.equal(details.subscription.current_period_end, '2026-12-31T00:00:00.000Z');

    const list = await service.findAll({ page: 1, limit: 10 } as unknown as ListAdminSchoolsQueryDto);
    assert.equal(list.items[0].subscription.status, SubscriptionStatus.ACTIVE);
    assert.equal(list.items[0].subscription.plan?.name, 'Pro');
  });

  it('falls back to the `none` subscription block for schools without one', async () => {
    const schoolId = '55555555-5555-4555-8555-555555555555';
    const schoolsRepo = makeSchoolsRepo([
      {
        id: schoolId,
        name: 'Hilltop',
        code: 'hilltop',
        subdomain: null,
        email: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
        timezone: 'UTC',
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as unknown as Record<string, unknown>[]);
    const sequelize = { fn: (name: string, col: unknown) => ({ fn: name, col }), col: (n: string) => n };
    const groupedModel = { sequelize, findAll: async () => [] as never[] };
    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      groupedModel as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      emptyGroupedRepo() as never,
      emptyGroupedRepo() as never,
    );

    const list = await service.findAll({ page: 1, limit: 10 } as unknown as ListAdminSchoolsQueryDto);
    assert.deepEqual(list.items[0].subscription, {
      status: 'none',
      plan: null,
      current_period_end: null,
    });
  });
});

describe('AdminSchoolsService.findOneOrThrow — School 360 resource overview', () => {
  it('reports stop and route-assignment counts alongside the existing stats', async () => {
    const schoolId = '66666666-6666-4666-8666-666666666666';
    const schoolsRepo = makeSchoolsRepo([
      {
        id: schoolId,
        name: 'Riverdale',
        code: 'riverdale',
        subdomain: null,
        email: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
        timezone: 'UTC',
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as unknown as Record<string, unknown>[]);
    const sequelize = {
      fn: (name: string, col: unknown) => ({ fn: name, col }),
      col: (n: string) => n,
    };
    const empty = { sequelize, findAll: async () => [] as never[] };
    const stopsRepo = {
      sequelize,
      findAll: async () => [{ count: 24 }] as never,
    };
    const assignmentsRepo = {
      sequelize,
      findAll: async () =>
        [
          { is_active: true, count: 5 },
          { is_active: false, count: 2 },
        ] as never,
    };

    const service = new AdminSchoolsService(
      schoolsRepo.repo as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
      {} as never,
      {} as never,
      makeSubscriptionsStub() as never,
      stopsRepo as never,
      assignmentsRepo as never,
    );

    const details = await service.findOneOrThrow(schoolId);
    assert.equal(details.stats.stop_count, 24);
    assert.equal(details.stats.assignment_count, 7);
    assert.equal(details.stats.active_assignment_count, 5);
    // Untouched buckets keep reporting zero rather than undefined.
    assert.equal(details.stats.student_count, 0);
    assert.equal(details.stats.route_count, 0);
  });
});
