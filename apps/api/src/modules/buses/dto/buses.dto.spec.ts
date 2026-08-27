import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateBusDto } from './create-bus.dto';
import { ListBusesQueryDto } from './list-buses-query.dto';
import { UpdateBusDto } from './update-bus.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const VALID_BODY = {
  registration_number: 'ABC-1234',
  bus_number: 'BUS-01',
  capacity: 48,
};

async function validateCreate(body: Record<string, unknown>) {
  return validate(plainToInstance(CreateBusDto, body));
}

async function validateUpdate(body: Record<string, unknown>) {
  return validate(plainToInstance(UpdateBusDto, body));
}

describe('CreateBusDto validation', () => {
  it('accepts a well-formed body', async () => {
    assert.equal((await validateCreate(VALID_BODY)).length, 0);
  });

  it('requires registration_number and capacity', async () => {
    const errors = await validateCreate({ bus_number: 'BUS-01' });
    assert.deepEqual(errors.map((error) => error.property).sort(), [
      'capacity',
      'registration_number',
    ]);
  });

  it('rejects a non-integer or non-positive capacity', async () => {
    const floatErrors = await validateCreate({ ...VALID_BODY, capacity: 48.5 });
    assert.deepEqual(
      floatErrors.map((error) => error.property),
      ['capacity'],
    );
    const zeroErrors = await validateCreate({ ...VALID_BODY, capacity: 0 });
    assert.deepEqual(
      zeroErrors.map((error) => error.property),
      ['capacity'],
    );
  });

  it('rejects an over-long registration number', async () => {
    const errors = await validateCreate({
      ...VALID_BODY,
      registration_number: 'X'.repeat(33),
    });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['registration_number'],
    );
  });

  it('accepts nullable optional fields', async () => {
    const errors = await validateCreate({ ...VALID_BODY, bus_number: null, is_active: false });
    assert.equal(errors.length, 0);
  });

  it('rejects a school_id supplied by the client', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { ...VALID_BODY, school_id: SCHOOL_ID },
        { metatype: CreateBusDto, type: 'body', data: '' },
      ),
      (error: { getStatus?: () => number }) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.getStatus?.(), 400);
        return true;
      },
    );
  });

  it('rejects an unknown field', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { ...VALID_BODY, owner_id: 'nope' },
        { metatype: CreateBusDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('UpdateBusDto validation', () => {
  it('accepts an empty partial update', async () => {
    assert.equal((await validateUpdate({})).length, 0);
  });

  it('accepts a single field update', async () => {
    assert.equal((await validateUpdate({ capacity: 60 })).length, 0);
  });

  it('rejects an invalid partial field', async () => {
    const errors = await validateUpdate({ capacity: -1 });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['capacity'],
    );
  });

  it('rejects a school_id supplied by the client', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { capacity: 60, school_id: SCHOOL_ID },
        { metatype: UpdateBusDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('ListBusesQueryDto validation', () => {
  it('applies sensible pagination defaults', async () => {
    const instance = plainToInstance(ListBusesQueryDto, {});
    const errors = await validate(instance);
    assert.equal(errors.length, 0);
    assert.equal(instance.page, 1);
    assert.equal(instance.limit, 20);
  });

  it('rejects out-of-range pagination', async () => {
    const errors = await validate(plainToInstance(ListBusesQueryDto, { page: 0, limit: 500 }));
    assert.deepEqual(errors.map((error) => error.property).sort(), ['limit', 'page']);
  });
});
