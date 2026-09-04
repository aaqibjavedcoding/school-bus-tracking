import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '../../../framework';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRouteDto } from './create-route.dto';
import { ListRoutesQueryDto } from './list-routes-query.dto';
import { ReorderRouteStopsDto } from './reorder-route-stops.dto';
import { UpdateRouteDto } from './update-route.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const STOP_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID_BODY = {
  name: 'North Loop — Morning',
  code: 'NORTH-AM',
  description: 'Serves the north campus',
};

async function validateCreate(body: Record<string, unknown>) {
  return validate(plainToInstance(CreateRouteDto, body));
}

async function validateUpdate(body: Record<string, unknown>) {
  return validate(plainToInstance(UpdateRouteDto, body));
}

describe('CreateRouteDto validation', () => {
  it('accepts a well-formed body', async () => {
    assert.equal((await validateCreate(VALID_BODY)).length, 0);
  });

  it('requires name and code', async () => {
    const errors = await validateCreate({ description: 'x' });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['code', 'name']);
  });

  it('rejects an over-long name or code', async () => {
    const errors = await validateCreate({
      ...VALID_BODY,
      name: 'X'.repeat(151),
      code: 'X'.repeat(33),
    });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['code', 'name']);
  });

  it('accepts nullable optional fields', async () => {
    const errors = await validateCreate({ ...VALID_BODY, description: null, is_active: false });
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
        { metatype: CreateRouteDto, type: 'body', data: '' },
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
        { metatype: CreateRouteDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('UpdateRouteDto validation', () => {
  it('accepts an empty partial update', async () => {
    assert.equal((await validateUpdate({})).length, 0);
  });

  it('accepts a single field update', async () => {
    assert.equal((await validateUpdate({ name: 'South Loop' })).length, 0);
  });

  it('rejects an invalid partial field', async () => {
    const errors = await validateUpdate({ code: '' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['code'],
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
        { name: 'South Loop', school_id: SCHOOL_ID },
        { metatype: UpdateRouteDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('ListRoutesQueryDto validation', () => {
  it('applies sensible pagination defaults', async () => {
    const instance = plainToInstance(ListRoutesQueryDto, {});
    const errors = await validate(instance);
    assert.equal(errors.length, 0);
    assert.equal(instance.page, 1);
    assert.equal(instance.limit, 20);
  });

  it('rejects out-of-range pagination', async () => {
    const errors = await validate(plainToInstance(ListRoutesQueryDto, { page: 0, limit: 500 }));
    assert.deepEqual(errors.map((error) => error.property).sort(), ['limit', 'page']);
  });
});

describe('ReorderRouteStopsDto validation', () => {
  it('accepts a list of UUIDs', async () => {
    const errors = await validate(plainToInstance(ReorderRouteStopsDto, { stop_ids: [STOP_UUID] }));
    assert.equal(errors.length, 0);
  });

  it('rejects non-UUID entries', async () => {
    const errors = await validate(
      plainToInstance(ReorderRouteStopsDto, { stop_ids: ['not-a-uuid'] }),
    );
    assert.deepEqual(
      errors.map((error) => error.property),
      ['stop_ids'],
    );
  });

  it('rejects a missing stop_ids', async () => {
    const errors = await validate(plainToInstance(ReorderRouteStopsDto, {}));
    assert.deepEqual(
      errors.map((error) => error.property),
      ['stop_ids'],
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
        { stop_ids: [STOP_UUID], school_id: SCHOOL_ID },
        { metatype: ReorderRouteStopsDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});
