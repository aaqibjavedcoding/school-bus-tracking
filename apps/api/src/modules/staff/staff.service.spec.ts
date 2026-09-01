import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { StaffResponse, TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { comparePassword } from '../../auth';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { PlanLimitsService } from '../../common/plan-limits';
import { StaffService } from './staff.service';
import {
  STAFF_EMAIL_TAKEN_MESSAGE,
  staffDeletedMessage,
  staffNotFoundMessage,
} from './staff.constants';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '11111111-1111-4111-8111-111111111111';
const CONDUCTOR_A = '22222222-2222-4222-8222-222222222222';
const DRIVER_B = '33333333-3333-4333-8333-333333333333';

interface StubStaff {
  id: string;
  school_id: string;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
  password_hash: string | null;
  email_verified_at: Date | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  update: (values: Record<string, unknown>) => Promise<StubStaff>;
  destroy: () => Promise<void>;
}

function makeStaff(overrides: Partial<StubStaff> = {}): StubStaff {
  const member: StubStaff = {
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    first_name: 'Dana',
    last_name: 'Driver',
    email: 'driver@example.org',
    password_hash: null,
    email_verified_at: null,
    phone: null,
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    deleted_at: null,
    update: async (values) => {
      Object.assign(member, values, { updated_at: new Date('2026-02-01T00:00:00.000Z') });
      return member;
    },
    destroy: async () => {
      member.deleted_at = new Date('2026-03-01T00:00:00.000Z');
      member.updated_at = member.deleted_at;
    },
  };
  Object.assign(member, overrides);
  return member;
}

function makeStaffRepository(
  existing: StubStaff[] = [],
  capture: {
    createPayload?: Record<string, unknown>;
    findOneWhere?: Record<string, unknown>;
    findAndCountWhere?: Record<PropertyKey, unknown>;
  } = {},
) {
  const records = [...existing];
  return {
    records,
    capture,
    repo: {
      findOne: async (options: { where: Record<string, unknown> }) => {
        capture.findOneWhere = options.where;
        return (records.find(
          (record) =>
            record.deleted_at === null &&
            Object.entries(options.where).every(
              ([key, value]) => record[key as keyof StubStaff] === value,
            ),
        ) ?? null) as unknown as User;
      },
      create: async (payload: Record<string, unknown>) => {
        capture.createPayload = payload;
        const member = makeStaff({
          id: `created-${records.length + 1}`,
          school_id: payload.school_id as string,
          role: payload.role as UserRole,
          first_name: payload.first_name as string,
          last_name: payload.last_name as string,
          email: payload.email as string,
          password_hash: payload.password_hash as string,
          phone: (payload.phone as string | null) ?? null,
          is_active: payload.is_active as boolean,
        });
        records.push(member);
        return member as unknown as User;
      },
      findAndCountAll: async (options: {
        where?: Record<PropertyKey, unknown>;
        limit?: number;
        offset?: number;
      }) => {
        capture.findAndCountWhere = options.where;
        const rows = records.filter(
          (record) =>
            record.deleted_at === null &&
            record.school_id === options.where?.['school_id'] &&
            record.role === options.where?.['role'],
        );
        // The service uses Sequelize's Op.or symbol for search; tenant and
        // role filtering are what this in-memory repository asserts on.
        void options.where?.[Symbol.for('sequelize.or')];
        const offset = options.offset ?? 0;
        const limit = options.limit ?? rows.length;
        return {
          rows: rows.slice(offset, offset + limit) as unknown as User[],
          count: rows.length,
        };
      },
    } as unknown as typeof User,
  };
}

/** Builds the service with the staff repository plus empty relation stubs. */
function allowAllPlanLimits(): PlanLimitsService {
  return {
    assertWithinLimit: async () => undefined,
    assertStaffWithinLimit: async () => undefined,
    // Transactional reservation used by the create paths. Without a database
    // the real service behaves the same way: assert, then run the work with
    // no transaction.
    runWithinLimit: async <T>(_schoolId: string, _resource: unknown, work: () => Promise<T>) =>
      work(),
    runWithinStaffLimit: async <T>(_schoolId: string, _role: unknown, work: () => Promise<T>) =>
      work(),
  } as unknown as PlanLimitsService;
}

function makeService(users: typeof User): StaffService {
  const empty = { findAll: async () => [] } as unknown as typeof Route;
  return new StaffService(
    users,
    empty as unknown as typeof RouteAssignment,
    empty as unknown as typeof Route,
    empty as unknown as typeof Bus,
    empty as unknown as typeof Trip,
    allowAllPlanLimits(),
  );
}

function staffDto(overrides: Partial<CreateStaffDto> = {}): CreateStaffDto {
  const dto = new CreateStaffDto();
  dto.first_name = 'Dana';
  dto.last_name = 'Driver';
  dto.email = 'Driver@Example.org';
  dto.password = 'correct-horse-battery';
  return Object.assign(dto, overrides);
}

function expectNotFound(promise: Promise<unknown>, message: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof NotFoundException);
    assert.equal(error.getStatus(), 404);
    assert.equal(error.message, message);
    return true;
  });
}

function expectConflict(promise: Promise<unknown>, message: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal(error.getStatus(), 409);
    assert.equal(error.message, message);
    return true;
  });
}

describe('StaffService driver management', () => {
  it('creates a DRIVER in the JWT tenant with the pinned role and bcrypt hash', async () => {
    const capture: { createPayload?: Record<string, unknown> } = {};
    const { repo: users } = makeStaffRepository([], capture);
    const service = makeService(users);

    const result = await service.create(SCHOOL_A, UserRole.DRIVER, staffDto());

    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
    assert.equal(capture.createPayload?.role, UserRole.DRIVER);
    assert.equal(capture.createPayload?.email, 'driver@example.org');
    const hash = capture.createPayload?.password_hash as string;
    assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'));
    assert.notEqual(hash, 'correct-horse-battery');
    assert.equal(await comparePassword('correct-horse-battery', hash), true);
    assert.equal(result.role, UserRole.DRIVER);
    assert.equal(result.school_id, SCHOOL_A);
    assert.ok(!JSON.stringify(result).includes('password'));
  });

  it('creates a CONDUCTOR when the conductor controller role is pinned', async () => {
    const capture: { createPayload?: Record<string, unknown> } = {};
    const { repo: users } = makeStaffRepository([], capture);
    const service = makeService(users);

    const result = await service.create(
      SCHOOL_A,
      UserRole.CONDUCTOR,
      staffDto({ email: 'conductor@example.org' }),
    );

    assert.equal(capture.createPayload?.role, UserRole.CONDUCTOR);
    assert.equal(result.role, UserRole.CONDUCTOR);
  });

  it('rejects duplicate email within the authenticated school across roles', async () => {
    const existing = makeStaff({
      id: CONDUCTOR_A,
      school_id: SCHOOL_A,
      role: UserRole.CONDUCTOR,
      email: 'driver@example.org',
    });
    const { repo: users } = makeStaffRepository([existing]);
    const service = makeService(users);
    await expectConflict(
      service.create(SCHOOL_A, UserRole.DRIVER, staffDto()),
      STAFF_EMAIL_TAKEN_MESSAGE,
    );
  });

  it('allows the same normalized email in another tenant', async () => {
    const existing = makeStaff({ id: DRIVER_B, school_id: SCHOOL_B });
    const capture: { createPayload?: Record<string, unknown> } = {};
    const { repo: users } = makeStaffRepository([existing], capture);
    const service = makeService(users);
    await service.create(SCHOOL_A, UserRole.DRIVER, staffDto());
    assert.equal(capture.createPayload?.school_id, SCHOOL_A);
  });

  it('translates a database email race into 409', async () => {
    const { repo: users } = makeStaffRepository();
    (users as unknown as { create: () => Promise<never> }).create = () =>
      Promise.reject(
        new UniqueConstraintError({
          message: 'duplicate key value violates unique constraint "uq_users_school_email"',
          fields: { email: 'driver@example.org' },
        }),
      );
    const service = makeService(users);
    await expectConflict(
      service.create(SCHOOL_A, UserRole.DRIVER, staffDto()),
      STAFF_EMAIL_TAKEN_MESSAGE,
    );
  });

  it('lists only DRIVER records from the JWT tenant', async () => {
    const { repo: users } = makeStaffRepository([
      makeStaff({ id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER }),
      makeStaff({ id: DRIVER_B, school_id: SCHOOL_B, role: UserRole.DRIVER }),
      makeStaff({ id: CONDUCTOR_A, school_id: SCHOOL_A, role: UserRole.CONDUCTOR }),
      makeStaff({ id: 'parent', school_id: SCHOOL_A, role: UserRole.PARENT }),
    ]);
    const service = makeService(users);
    const result = await service.findAll(SCHOOL_A, UserRole.DRIVER, new ListStaffQueryDto());
    assert.deepEqual(
      result.items.map((item) => item.id),
      [DRIVER_A],
    );
    assert.equal(result.items[0].school_id, SCHOOL_A);
    assert.equal(result.meta.total, 1);
  });

  it('returns the assigned bus, route and current trip status', async () => {
    const { repo: users } = makeStaffRepository([
      makeStaff({ id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER }),
    ]);

    const assignments = {
      findAll: async () =>
        [
          { user_id: DRIVER_A, route_id: 'route-1', bus_id: 'bus-1', effective_from: '2026-01-01' },
        ] as unknown as RouteAssignment[],
    } as unknown as typeof RouteAssignment;
    const routes = {
      findAll: async () => [{ id: 'route-1', name: 'North Loop', code: 'N1' }] as unknown as Route[],
    } as unknown as typeof Route;
    const buses = {
      findAll: async () =>
        [{ id: 'bus-1', bus_number: 'B-01', registration_number: 'REG-A' }] as unknown as Bus[],
    } as unknown as typeof Bus;
    const trips = {
      findAll: async () =>
        [{ driver_id: DRIVER_A, status: TripStatus.BOARDING, scheduled_start_at: new Date() }] as unknown as Trip[],
    } as unknown as typeof Trip;

    const service = new StaffService(users, assignments, routes, buses, trips, allowAllPlanLimits());
    const result = await service.findAll(SCHOOL_A, UserRole.DRIVER, new ListStaffQueryDto());

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].assigned_route_name, 'North Loop');
    assert.equal(result.items[0].assigned_route_code, 'N1');
    assert.equal(result.items[0].assigned_bus_number, 'B-01');
    assert.equal(result.items[0].assigned_bus_registration, 'REG-A');
    assert.equal(result.items[0].current_trip_status, TripStatus.BOARDING);
  });

  it('returns a generic role-specific 404 for other tenant, other role and missing account', async () => {
    const { repo: users } = makeStaffRepository([
      makeStaff({ id: DRIVER_B, school_id: SCHOOL_B, role: UserRole.DRIVER }),
      makeStaff({ id: CONDUCTOR_A, school_id: SCHOOL_A, role: UserRole.CONDUCTOR }),
    ]);
    const service = makeService(users);
    await expectNotFound(
      service.findOne(SCHOOL_A, UserRole.DRIVER, DRIVER_B),
      staffNotFoundMessage(UserRole.DRIVER),
    );
    // A driver id cannot be read or mutated through the conductor resource.
    await expectNotFound(
      service.findOne(SCHOOL_A, UserRole.CONDUCTOR, DRIVER_A),
      staffNotFoundMessage(UserRole.CONDUCTOR),
    );
    await expectNotFound(
      service.findOne(SCHOOL_A, UserRole.DRIVER, '99999999-9999-4999-8999-999999999999'),
      staffNotFoundMessage(UserRole.DRIVER),
    );
  });

  it('updates profile fields and bcrypt-hashes a changed password without changing ownership', async () => {
    const driver = makeStaff({ id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER });
    const { repo: users } = makeStaffRepository([driver]);
    const service = makeService(users);
    const dto = new UpdateStaffDto();
    dto.first_name = 'Dana-Marie';
    dto.password = 'new-correct-password';
    dto.phone = '+1 555 0199';

    const result = await service.update(SCHOOL_A, UserRole.DRIVER, DRIVER_A, dto);
    assert.equal(result.first_name, 'Dana-Marie');
    assert.equal(driver.school_id, SCHOOL_A);
    assert.equal(driver.role, UserRole.DRIVER);
    assert.ok(driver.password_hash);
    assert.equal(await comparePassword('new-correct-password', driver.password_hash!), true);
    assert.notEqual(driver.password_hash, 'new-correct-password');
  });

  it('rejects changing to another user email inside the same school', async () => {
    const driver = makeStaff({ id: DRIVER_A, email: 'one@example.org' });
    const conductor = makeStaff({
      id: CONDUCTOR_A,
      role: UserRole.CONDUCTOR,
      email: 'two@example.org',
    });
    const { repo: users } = makeStaffRepository([driver, conductor]);
    const service = makeService(users);
    const dto = new UpdateStaffDto();
    dto.email = 'two@example.org';
    await expectConflict(
      service.update(SCHOOL_A, UserRole.DRIVER, DRIVER_A, dto),
      STAFF_EMAIL_TAKEN_MESSAGE,
    );
  });

  it('soft-deletes only an in-tenant, in-role staff account with a role-specific message', async () => {
    const driver = makeStaff({ id: DRIVER_A, school_id: SCHOOL_A, role: UserRole.DRIVER });
    const { repo: users } = makeStaffRepository([driver]);
    const service = makeService(users);
    const result = await service.remove(SCHOOL_A, UserRole.DRIVER, DRIVER_A);
    assert.equal(driver.deleted_at?.toISOString(), '2026-03-01T00:00:00.000Z');
    assert.deepEqual(result, {
      id: DRIVER_A,
      message: staffDeletedMessage(UserRole.DRIVER),
    });
    assert.equal(staffDeletedMessage(UserRole.CONDUCTOR), 'Conductor account deleted successfully');
  });

  it('cannot soft-delete a conductor through the driver resource', async () => {
    const conductor = makeStaff({ id: CONDUCTOR_A, role: UserRole.CONDUCTOR });
    const { repo: users } = makeStaffRepository([conductor]);
    const service = makeService(users);
    await expectNotFound(
      service.remove(SCHOOL_A, UserRole.DRIVER, CONDUCTOR_A),
      staffNotFoundMessage(UserRole.DRIVER),
    );
    assert.equal(conductor.deleted_at, null);
  });

  it('never leaks the password hash in a serialized response', async () => {
    const driver = makeStaff({ id: DRIVER_A, password_hash: 'secret-hash' });
    const { repo: users } = makeStaffRepository([driver]);
    const service = makeService(users);
    const response: StaffResponse = await service.findOne(SCHOOL_A, UserRole.DRIVER, DRIVER_A);
    assert.equal(JSON.stringify(response).includes('password_hash'), false);
    assert.equal('password_hash' in response, false);
  });
});
