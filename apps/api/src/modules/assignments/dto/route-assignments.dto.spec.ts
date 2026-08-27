import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RouteAssignmentRole } from '@school-bus-tracking/shared-types';
import {
  routeAssignmentCreateSchema,
  routeAssignmentListQuerySchema,
  routeAssignmentUpdateSchema,
} from '@school-bus-tracking/validation';
import { CreateRouteAssignmentDto } from './create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from './list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from './update-route-assignment.dto';

const ROUTE_ID = '11111111-1111-4111-8111-111111111111';
const BUS_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';

const VALID_BODY = {
  route_id: ROUTE_ID,
  bus_id: BUS_ID,
  user_id: USER_ID,
  role: RouteAssignmentRole.DRIVER,
  effective_from: '2026-08-27',
  effective_to: '2026-12-31',
  is_active: true,
};

async function errorsFor<T extends object>(type: new () => T, body: Record<string, unknown>) {
  return validate(plainToInstance(type, body));
}

describe('route assignment DTO validation', () => {
  it('accepts a complete DRIVER assignment and transforms booleans', async () => {
    const dto = plainToInstance(CreateRouteAssignmentDto, {
      ...VALID_BODY,
      is_active: 'false',
    });
    assert.equal((await validate(dto)).length, 0);
    assert.equal(dto.is_active, false);
  });

  it('requires route, bus, user, role and effective_from', async () => {
    const errors = await errorsFor(CreateRouteAssignmentDto, {});
    const properties = errors.map((error) => error.property);
    for (const property of ['route_id', 'bus_id', 'user_id', 'role', 'effective_from']) {
      assert.ok(properties.includes(property), `${property} should be required`);
    }
  });

  it('rejects arbitrary user roles and malformed identifiers', async () => {
    const errors = await errorsFor(CreateRouteAssignmentDto, {
      ...VALID_BODY,
      route_id: 'not-a-uuid',
      role: 'SCHOOL_ADMIN',
    });
    assert.deepEqual([...new Set(errors.map((error) => error.property))].sort(), [
      'role',
      'route_id',
    ]);
  });

  it('rejects malformed and invalid calendar dates', async () => {
    const formatErrors = await errorsFor(CreateRouteAssignmentDto, {
      ...VALID_BODY,
      effective_from: '27-08-2026',
    });
    assert.ok(formatErrors.some((error) => error.property === 'effective_from'));

    const calendarErrors = await errorsFor(CreateRouteAssignmentDto, {
      ...VALID_BODY,
      effective_from: '2026-02-30',
    });
    assert.ok(calendarErrors.some((error) => error.property === 'effective_from'));
  });

  it('accepts an open-ended assignment and partial updates', async () => {
    const createErrors = await errorsFor(CreateRouteAssignmentDto, {
      ...VALID_BODY,
      effective_to: null,
    });
    assert.equal(createErrors.length, 0);
    assert.equal((await errorsFor(UpdateRouteAssignmentDto, {})).length, 0);
    assert.equal(
      (await errorsFor(UpdateRouteAssignmentDto, { bus_id: null, is_active: false })).length,
      0,
    );
  });

  it('rejects client-controlled tenant and unknown fields through the global pipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    for (const field of ['school_id', 'owner_id', 'password_hash']) {
      await assert.rejects(
        pipe.transform(
          { ...VALID_BODY, [field]: field === 'school_id' ? SCHOOL_ID : 'nope' },
          { metatype: CreateRouteAssignmentDto, type: 'body', data: '' },
        ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          return true;
        },
      );
    }
  });

  it('validates assignment query filters and boolean values', async () => {
    const query = plainToInstance(ListRouteAssignmentsQueryDto, {
      page: '2',
      limit: '10',
      route_id: ROUTE_ID,
      role: RouteAssignmentRole.CONDUCTOR,
      is_active: 'false',
    });
    assert.equal((await validate(query)).length, 0);
    assert.equal(query.page, 2);
    assert.equal(query.is_active, false);
    assert.equal(plainToInstance(ListRouteAssignmentsQueryDto, {}).limit, 20);
  });
});

describe('route assignment Zod schemas', () => {
  it('accept a strict complete assignment and reject escalation fields', () => {
    const parsed = routeAssignmentCreateSchema.parse(VALID_BODY);
    assert.equal(parsed.role, RouteAssignmentRole.DRIVER);
    assert.throws(() => routeAssignmentCreateSchema.parse({ ...VALID_BODY, school_id: SCHOOL_ID }));
    assert.throws(() => routeAssignmentCreateSchema.parse({ ...VALID_BODY, role: 'SUPER_ADMIN' }));
    assert.throws(() =>
      routeAssignmentCreateSchema.parse({ ...VALID_BODY, effective_to: '2026-01-01' }),
    );
  });

  it('accepts partial updates and validates list filters', () => {
    assert.deepEqual(routeAssignmentUpdateSchema.parse({ is_active: false }), { is_active: false });
    assert.throws(() => routeAssignmentUpdateSchema.parse({ school_id: SCHOOL_ID }));
    const query = routeAssignmentListQuerySchema.parse({ role: 'CONDUCTOR', is_active: 'false' });
    assert.equal(query.role, RouteAssignmentRole.CONDUCTOR);
    assert.equal(query.is_active, false);
  });
});
