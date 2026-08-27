import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { staffCreateSchema, staffUpdateSchema } from '@school-bus-tracking/validation';
import { CreateStaffDto } from './create-staff.dto';
import { ListStaffQueryDto } from './list-staff-query.dto';
import { UpdateStaffDto } from './update-staff.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';

const VALID_STAFF = {
  first_name: '  Dana ',
  last_name: ' Driver ',
  email: ' Driver@Example.ORG ',
  password: 'correct-horse-battery',
  phone: ' +1 555 0100 ',
  is_active: false,
};

async function errorsFor<T extends object>(type: new () => T, body: Record<string, unknown>) {
  return validate(plainToInstance(type, body));
}

describe('staff account DTO validation', () => {
  it('accepts a valid account and transforms safe fields', async () => {
    const dto = plainToInstance(CreateStaffDto, VALID_STAFF);
    assert.equal((await validate(dto)).length, 0);
    assert.equal(dto.first_name, 'Dana');
    assert.equal(dto.last_name, 'Driver');
    assert.equal(dto.email, 'driver@example.org');
    assert.equal(dto.phone, '+1 555 0100');
    assert.equal(dto.is_active, false);
  });

  it('requires names, email and a policy-compliant password', async () => {
    const errors = await errorsFor(CreateStaffDto, {
      first_name: undefined,
      last_name: 'Driver',
      email: 'not-an-email',
      password: 'short',
    });
    assert.deepEqual(errors.map((error) => error.property).sort(), [
      'email',
      'first_name',
      'password',
    ]);
  });

  it('rejects password whitespace at either boundary', async () => {
    const errors = await errorsFor(CreateStaffDto, {
      ...VALID_STAFF,
      password: ' password-with-space ',
    });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['password'],
    );
  });

  it('coerces string booleans in the query and defaults pagination', async () => {
    const query = plainToInstance(ListStaffQueryDto, { page: '3', limit: '50', search: ' Dana ' });
    assert.equal((await validate(query)).length, 0);
    assert.equal(query.page, 3);
    assert.equal(query.limit, 50);
    assert.equal(query.search, 'Dana');

    const defaults = plainToInstance(ListStaffQueryDto, {});
    assert.equal(defaults.page, 1);
    assert.equal(defaults.limit, 20);
  });

  it('rejects client-controlled tenant, role and credential fields through the global pipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    for (const [field, value] of [
      ['school_id', SCHOOL_ID],
      ['role', 'DRIVER'],
      ['password_hash', '$2b$12$abcdef'],
      ['is_superuser', true],
    ] as const) {
      await assert.rejects(
        pipe.transform(
          { ...VALID_STAFF, [field]: value },
          { metatype: CreateStaffDto, type: 'body', data: '' },
        ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          return true;
        },
      );
    }
  });

  it('validates partial updates, empty body and short password rejection', async () => {
    assert.equal((await errorsFor(UpdateStaffDto, {})).length, 0);
    const errors = await errorsFor(UpdateStaffDto, { password: 'short' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['password'],
    );

    // Updates must also reject role/tenant escalation attempts.
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { first_name: 'Dana', role: 'SUPER_ADMIN' },
        { metatype: UpdateStaffDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('staff Zod schemas', () => {
  it('validate staff creation and reject tenant and role fields', () => {
    const parsed = staffCreateSchema.parse({
      first_name: 'Dana',
      last_name: 'Driver',
      email: 'Driver@Example.org',
      password: 'correct-horse-battery',
    });
    assert.equal(parsed.email, 'driver@example.org');
    for (const extra of [
      { school_id: SCHOOL_ID },
      { role: 'DRIVER' },
      { role: 'SUPER_ADMIN' },
      { password_hash: 'x' },
    ]) {
      assert.throws(() => staffCreateSchema.parse({ ...parsed, ...extra }));
    }
  });

  it('validate partial staff updates and reject escalation fields', () => {
    const parsed = staffUpdateSchema.parse({ phone: '+1 555 0100', is_active: false });
    assert.equal(parsed.is_active, false);
    assert.throws(() => staffUpdateSchema.parse({ role: 'SCHOOL_ADMIN' }));
    assert.throws(() => staffUpdateSchema.parse({ school_id: SCHOOL_ID }));
  });
});
