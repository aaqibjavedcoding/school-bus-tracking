import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError } from 'sequelize';
import { UserRole } from '@school-bus-tracking/shared-types';
import { comparePassword } from '../../auth';
import { AdminSchoolAdminsService } from './admin-school-admins.service';
import {
  ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE,
  SCHOOL_ADMIN_NOT_FOUND_MESSAGE,
  SCHOOL_ADMIN_PASSWORD_RESET_MESSAGE,
  SCHOOL_NOT_FOUND_MESSAGE,
} from './admin.constants';

/**
 * Unit suite for Super Admin management of a tenant's SCHOOL_ADMIN accounts.
 *
 * Uses the same Sequelize-shaped in-memory stubs as the other Admin service
 * suites. Each case exercises the tenant pinning that the service derives
 * from the route school id: a caller can never address an admin that does not
 * belong to `(school_id, role=SCHOOL_ADMIN)`, even if it knows another
 * school's admin id.
 */

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SCHOOL_ID = '11111111-1111-4111-8111-111111111112';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ADMIN_ID = '33333333-3333-4333-8333-333333333334';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

type Row = Record<string, unknown>;

const EMAIL = '  Admin@Example.com ';

function makeSchoolsRepo(ids: string[] = [SCHOOL_ID, OTHER_SCHOOL_ID]) {
  return {
    findOne: async ({ where }: { where: Row }) =>
      (ids.includes(String(where.id)) ? { id: where.id } : null) as never,
  };
}

function row(overrides: Row = {}): Row {
  const createdAt = new Date('2026-02-01T00:00:00.000Z');
  const r: Row = {
    id: ADMIN_ID,
    school_id: SCHOOL_ID,
    role: UserRole.SCHOOL_ADMIN,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'admin@example.com',
    phone: null,
    is_active: true,
    email_verified_at: null,
    password_hash: '$2b$12$not-a-real-hash',
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
  r.update = async function update(this: Row, patch: Row) {
    Object.assign(this, patch, { updated_at: new Date() });
    return this;
  };
  r.reload = async function reload(this: Row) {
    return this;
  };
  return r;
}

function makeUsersRepo(initial: Row[] = []) {
  const rows = [...initial];
  let seq = 0;

  const matches = (candidate: Row, where: Row): boolean =>
    Reflect.ownKeys(where).every((key) => {
      const value = (where as Record<PropertyKey, unknown>)[key];
      if (typeof key === 'symbol' && key === Op.or) {
        const orList = (where as Record<PropertyKey, unknown>)[Op.or] as Row[] | undefined;
        return (orList ?? []).some((sub) => matches(candidate, sub));
      }
      if (value && typeof value === 'object') {
        const v = value as Record<PropertyKey, unknown>;
        const orList = v[Op.or] as Row[] | undefined;
        if (orList && Array.isArray(orList)) {
          return orList.some((sub) =>
            Object.entries(sub).every(([subKey, subValue]) => {
              const inner = subValue as Record<PropertyKey, unknown>;
              if (inner[Op.iLike] !== undefined) {
                const pattern = String(inner[Op.iLike]).replace(/^%|%$/g, '').toLowerCase();
                return String(candidate[subKey]).toLowerCase().includes(pattern);
              }
              return candidate[subKey] === subValue;
            }),
          );
        }
        if ((v as Record<PropertyKey, unknown>)[Op.iLike] !== undefined) {
          const pattern = String((v as Record<PropertyKey, unknown>)[Op.iLike])
            .replace(/^%|%$/g, '')
            .toLowerCase();
          return String((candidate as Record<PropertyKey, unknown>)[key]).toLowerCase().includes(pattern);
        }
      }
      return (candidate as Record<PropertyKey, unknown>)[key] === value;
    });

  const sort = (list: Row[], order: Array<[string, string]> = [['created_at', 'ASC']]) =>
    [...list].sort((a, b) => {
      for (const [column, direction] of order) {
        const av = a[column] as never;
        const bv = b[column] as never;
        if (av === bv) continue;
        return (av < bv ? -1 : 1) * (direction === 'ASC' ? 1 : -1);
      }
      return 0;
    });

  const repo = {
    unscoped: () => repo,
    async findAndCountAll({
      where,
      limit,
      offset,
      order,
    }: {
      where: Row;
      limit: number;
      offset: number;
      order: Array<[string, string]>;
    }) {
      const filtered = rows.filter((r) => matches(r, where));
      const ordered = sort(filtered, order);
      return {
        rows: ordered.slice(offset ?? 0, (offset ?? 0) + (limit ?? rows.length)) as never,
        count: filtered.length,
      };
    },
    async findOne({ where }: { where: Row }) {
      return (rows.find((r) => matches(r, where)) ?? null) as never;
    },
    async create(payload: Row) {
      const duplicate = rows.find(
        (r) => r.school_id === payload.school_id && r.email === payload.email,
      );
      if (duplicate) {
        throw new UniqueConstraintError({ message: 'duplicate', errors: [] });
      }
      seq += 1;
      const created: Row = row({
        id: `admin-${seq}`,
        school_id: payload.school_id,
        role: payload.role,
        first_name: payload.first_name,
        last_name: payload.last_name,
        email: payload.email,
        phone: payload.phone,
        is_active: payload.is_active,
        password_hash: payload.password_hash,
      });
      rows.push(created);
      return created as never;
    },
  };
  return { rows, repo };
}

function makeService() {
  const schools = makeSchoolsRepo();
  const users = makeUsersRepo();
  const service = new AdminSchoolAdminsService(schools as never, users.repo as never);
  return { service, users };
}

function makeServiceWithAdmins() {
  const schools = makeSchoolsRepo();
  const users = makeUsersRepo([row()]);
  const service = new AdminSchoolAdminsService(schools as never, users.repo as never);
  return { service, users };
}

describe('AdminSchoolAdminsService — create', () => {
  it('creates a SCHOOL_ADMIN pinned to the route school and hashes the password', async () => {
    const { service, users } = makeService();
    const result = await service.create(SCHOOL_ID, {
      first_name: '  Ada  ',
      last_name: ' Lovelace ',
      email: EMAIL,
      password: 'correct-horse-battery',
      phone: ' 555-1234 ',
      is_active: true,
    });

    assert.equal(result.school_id, SCHOOL_ID);
    assert.equal(result.role, UserRole.SCHOOL_ADMIN);
    assert.equal(result.first_name, 'Ada');
    assert.equal(result.last_name, 'Lovelace');
    assert.equal(result.email, 'admin@example.com');
    assert.equal(result.phone, '555-1234');
    assert.equal(result.is_active, true);

    const stored = users.rows.find((r) => r.email === 'admin@example.com') as Row;
    assert.notEqual(stored.password_hash, 'correct-horse-battery');
    assert.equal(await comparePassword('correct-horse-battery', stored.password_hash as string), true);
  });

  it('rejects a duplicate email in the same school', async () => {
    const { service } = makeServiceWithAdmins();
    await assert.rejects(
      service.create(SCHOOL_ID, {
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'admin@example.com',
        password: 'correct-horse-battery',
      }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.message, ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE);
        return true;
      },
    );
  });

  it('does not treat an email in another school as a duplicate', async () => {
    const { service } = makeService();
    const result = await service.create(OTHER_SCHOOL_ID, {
      first_name: 'Grace',
      last_name: 'Hopper',
      email: EMAIL,
      password: 'correct-horse-battery',
    });
    assert.equal(result.school_id, OTHER_SCHOOL_ID);
    assert.equal(result.email, 'admin@example.com');
  });

  it('throws 404 when the school does not exist', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.create(MISSING_ID, {
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'new@example.com',
        password: 'correct-horse-battery',
      }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, SCHOOL_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });
});

describe('AdminSchoolAdminsService — update', () => {
  it('updates profile fields, normalizes email and hashes a new password', async () => {
    const { service, users } = makeServiceWithAdmins();
    assert.equal(users.rows.length, 1);
    const result = await service.update(SCHOOL_ID, ADMIN_ID, {
      first_name: 'Grace',
      last_name: ' Hopper ',
      email: EMAIL,
      password: 'new-strong-password',
      phone: ' 123 ',
      is_active: false,
    });

    assert.equal(result.first_name, 'Grace');
    assert.equal(result.last_name, 'Hopper');
    assert.equal(result.email, 'admin@example.com');
    assert.equal(result.phone, '123');
    assert.equal(result.is_active, false);
    const stored = users.rows[0] as Row;
    assert.equal(await comparePassword('new-strong-password', stored.password_hash as string), true);
  });

  it('rejects an email that belongs to another admin in the same school', async () => {
    const { service, users } = makeServiceWithAdmins();
    users.rows.push(
      row({
        id: OTHER_ADMIN_ID,
        school_id: SCHOOL_ID,
        email: 'taken@example.com',
      }),
    );
    await assert.rejects(
      service.update(SCHOOL_ID, ADMIN_ID, { email: 'taken@example.com' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.message, ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE);
        return true;
      },
    );
  });
});

describe('AdminSchoolAdminsService — cross-school and role protection', () => {
  it('never returns an admin that belongs to another school', async () => {
    const { service } = makeServiceWithAdmins();
    await assert.rejects(
      service.update(OTHER_SCHOOL_ID, ADMIN_ID, { first_name: 'Nope' }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, SCHOOL_ADMIN_NOT_FOUND_MESSAGE);
        return true;
      },
    );
    await assert.rejects(
      service.setActive(OTHER_SCHOOL_ID, ADMIN_ID, false),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        return true;
      },
    );
    await assert.rejects(
      service.resetPassword(OTHER_SCHOOL_ID, ADMIN_ID, { password: 'password123' }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        return true;
      },
    );
  });

  it('only lists admins of the requested school and role', async () => {
    const { service, users } = makeServiceWithAdmins();
    users.rows.push(
      row({ id: OTHER_ADMIN_ID, school_id: OTHER_SCHOOL_ID, email: 'other@example.com' }),
      row({
        id: '33333333-3333-4333-8333-333333333335',
        school_id: SCHOOL_ID,
        role: UserRole.DRIVER,
        email: 'driver@example.com',
      }),
    );

    const result = await service.list(SCHOOL_ID, { page: 1, limit: 20 });
    assert.equal(result.meta.total, 1);
    assert.equal(result.items[0].id, ADMIN_ID);
    assert.equal(result.items[0].school_id, SCHOOL_ID);
    assert.equal(result.items[0].role, UserRole.SCHOOL_ADMIN);
  });

  it('searches school admins by name or email', async () => {
    const { service, users } = makeServiceWithAdmins();
    users.rows.push(row({ id: OTHER_ADMIN_ID, email: 'second@example.com', first_name: 'Second' }));
    const result = await service.list(SCHOOL_ID, { page: 1, limit: 20, search: 'second' });
    assert.equal(result.meta.total, 1);
    assert.equal(result.items[0].id, OTHER_ADMIN_ID);
  });
});

describe('AdminSchoolAdminsService — lifecycle and reset', () => {
  it('deactivates and reactivates an admin', async () => {
    const { service } = makeServiceWithAdmins();
    const deactivated = await service.setActive(SCHOOL_ID, ADMIN_ID, false);
    assert.equal(deactivated.is_active, false);
    const activated = await service.setActive(SCHOOL_ID, ADMIN_ID, true);
    assert.equal(activated.is_active, true);
  });

  it('resets the password and never returns credentials', async () => {
    const { service, users } = makeServiceWithAdmins();
    const result = await service.resetPassword(SCHOOL_ID, ADMIN_ID, {
      password: 'reset-strong-password',
    });
    assert.equal(result.id, ADMIN_ID);
    assert.equal(result.message, SCHOOL_ADMIN_PASSWORD_RESET_MESSAGE);
    const stored = users.rows[0] as Row;
    assert.equal(await comparePassword('reset-strong-password', stored.password_hash as string), true);
    assert.equal('password_hash' in (service as unknown as Record<string, unknown>), false);
  });
});
