import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AdminSchoolsService } from './admin-schools.service';
import { SchoolsService } from '../schools/schools.service';
import { SCHOOL_NOT_FOUND_MESSAGE } from './admin.constants';
import type { ListAdminSchoolsQueryDto } from './dto';

/** Minimal shared stub helpers — the service only touches these surfaces. */

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
    );
    await assert.rejects(
      service.update('b', { email: 'shared@x.test' }),
      (error: unknown) => error instanceof ConflictException,
    );
  });
});
