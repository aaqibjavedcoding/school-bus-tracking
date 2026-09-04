import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '../../../framework';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateStopDto } from './create-stop.dto';
import { ListStopsQueryDto } from './list-stops-query.dto';
import { UpdateStopDto } from './update-stop.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID_BODY = {
  route_id: ROUTE_UUID,
  name: 'Maple St & 5th Ave',
  address: 'Maple St & 5th Ave, Springfield',
  latitude: 40.7128,
  longitude: -74.006,
  geofence_radius_meters: 150,
  sequence_number: 3,
  estimated_arrival_time: '08:15',
};

async function validateCreate(body: Record<string, unknown>) {
  return validate(plainToInstance(CreateStopDto, body));
}

async function validateUpdate(body: Record<string, unknown>) {
  return validate(plainToInstance(UpdateStopDto, body));
}

describe('CreateStopDto validation', () => {
  it('accepts a well-formed body', async () => {
    assert.equal((await validateCreate(VALID_BODY)).length, 0);
  });

  it('accepts a body without the optional ordering fields', async () => {
    const errors = await validateCreate({ route_id: ROUTE_UUID, name: 'Main Gate' });
    assert.equal(errors.length, 0);
  });

  it('requires route_id and name', async () => {
    const errors = await validateCreate({});
    assert.deepEqual(errors.map((error) => error.property).sort(), ['name', 'route_id']);
  });

  it('rejects a non-UUID route_id', async () => {
    const errors = await validateCreate({ ...VALID_BODY, route_id: 'not-a-uuid' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['route_id'],
    );
  });

  it('rejects out-of-range coordinates', async () => {
    const errors = await validateCreate({
      ...VALID_BODY,
      latitude: 91,
      longitude: -181,
    });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['latitude', 'longitude']);
  });

  it('rejects an out-of-range geofence radius', async () => {
    const errors = await validateCreate({ ...VALID_BODY, geofence_radius_meters: 9 });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['geofence_radius_meters'],
    );
  });

  it('rejects a non-positive sequence number', async () => {
    const errors = await validateCreate({ ...VALID_BODY, sequence_number: 0 });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['sequence_number'],
    );
  });

  it('rejects a malformed estimated_arrival_time', async () => {
    const errors = await validateCreate({ ...VALID_BODY, estimated_arrival_time: '8:15 PM' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['estimated_arrival_time'],
    );
  });

  it('accepts nullable optional fields', async () => {
    const errors = await validateCreate({
      ...VALID_BODY,
      address: null,
      latitude: null,
      longitude: null,
      estimated_arrival_time: null,
      is_active: false,
    });
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
        { metatype: CreateStopDto, type: 'body', data: '' },
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
        { metatype: CreateStopDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('UpdateStopDto validation', () => {
  it('accepts an empty partial update', async () => {
    assert.equal((await validateUpdate({})).length, 0);
  });

  it('accepts a single field update', async () => {
    assert.equal((await validateUpdate({ name: 'Rear Gate' })).length, 0);
  });

  it('rejects null route_id (a stop always belongs to one route)', async () => {
    const errors = await validateUpdate({ route_id: null });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['route_id'],
    );
  });

  it('rejects an invalid partial field', async () => {
    const errors = await validateUpdate({ sequence_number: -1 });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['sequence_number'],
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
        { name: 'Rear Gate', school_id: SCHOOL_ID },
        { metatype: UpdateStopDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('ListStopsQueryDto validation', () => {
  it('applies sensible pagination defaults', async () => {
    const instance = plainToInstance(ListStopsQueryDto, {});
    const errors = await validate(instance);
    assert.equal(errors.length, 0);
    assert.equal(instance.page, 1);
    assert.equal(instance.limit, 20);
  });

  it('rejects out-of-range pagination', async () => {
    const errors = await validate(plainToInstance(ListStopsQueryDto, { page: 0, limit: 500 }));
    assert.deepEqual(errors.map((error) => error.property).sort(), ['limit', 'page']);
  });

  it('rejects a non-UUID route_id filter', async () => {
    const errors = await validate(plainToInstance(ListStopsQueryDto, { route_id: 'nope' }));
    assert.deepEqual(
      errors.map((error) => error.property),
      ['route_id'],
    );
  });
});
