import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '../../../framework';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TripStatus } from '@school-bus-tracking/shared-types';
import {
  TRIP_STATUS_TRANSITIONS,
  isTripStatusTransitionAllowed,
  tripCancelSchema,
  tripCreateSchema,
  tripListQuerySchema,
  tripStatusUpdateSchema,
  tripUpdateSchema,
} from '@school-bus-tracking/validation';
import { CancelTripDto } from './cancel-trip.dto';
import { CreateTripDto } from './create-trip.dto';
import { ListTripsQueryDto } from './list-trips-query.dto';
import { UpdateTripDto } from './update-trip.dto';
import { UpdateTripStatusDto } from './update-trip-status.dto';

const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_ID = '33333333-3333-4333-8333-333333333333';

const VALID_BODY = {
  route_assignment_id: ASSIGNMENT_ID,
  scheduled_start_at: '2026-09-01T06:30:00.000Z',
  scheduled_end_at: '2026-09-01T07:30:00.000Z',
};

async function errorsFor<T extends object>(type: new () => T, body: Record<string, unknown>) {
  return validate(plainToInstance(type, body));
}

describe('trip DTO validation', () => {
  it('accepts a complete dispatch request', async () => {
    assert.equal((await errorsFor(CreateTripDto, VALID_BODY)).length, 0);
    assert.equal(
      (await errorsFor(CreateTripDto, { ...VALID_BODY, scheduled_end_at: null })).length,
      0,
    );
  });

  it('requires the assignment id and a valid departure time', async () => {
    const missing = await errorsFor(CreateTripDto, {});
    assert.deepEqual(missing.map((error) => error.property).sort(), [
      'route_assignment_id',
      'scheduled_start_at',
    ]);

    const malformed = await errorsFor(CreateTripDto, {
      route_assignment_id: 'not-a-uuid',
      scheduled_start_at: '01-09-2026',
    });
    assert.deepEqual(malformed.map((error) => error.property).sort(), [
      'route_assignment_id',
      'scheduled_start_at',
    ]);
  });

  it('accepts an empty patch and rejects malformed patch values', async () => {
    assert.equal((await errorsFor(UpdateTripDto, {})).length, 0);
    assert.equal(
      (
        await errorsFor(UpdateTripDto, {
          scheduled_end_at: null,
          route_assignment_id: ASSIGNMENT_ID,
        })
      ).length,
      0,
    );
    const errors = await errorsFor(UpdateTripDto, { scheduled_start_at: 'yesterday' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['scheduled_start_at'],
    );
  });

  it('accepts each lifecycle status and rejects unknown ones', async () => {
    for (const status of Object.values(TripStatus)) {
      assert.equal((await errorsFor(UpdateTripStatusDto, { status })).length, 0);
    }
    const errors = await errorsFor(UpdateTripStatusDto, { status: 'DEPARTED' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['status'],
    );
  });

  it('trims the cancellation reason and enforces its bounds', async () => {
    const dto = plainToInstance(CancelTripDto, { cancellation_reason: '  Heavy snow  ' });
    assert.equal((await validate(dto)).length, 0);
    assert.equal(dto.cancellation_reason, 'Heavy snow');

    assert.equal((await errorsFor(CancelTripDto, {})).length, 0);
    assert.equal((await errorsFor(CancelTripDto, { cancellation_reason: '   ' })).length, 1);
    assert.equal(
      (await errorsFor(CancelTripDto, { cancellation_reason: 'x'.repeat(501) })).length,
      1,
    );
  });

  it('coerces and bounds the list query', async () => {
    const query = plainToInstance(ListTripsQueryDto, {
      page: '2',
      limit: '50',
      status: TripStatus.IN_PROGRESS,
      route_id: ROUTE_ID,
      date: '2026-09-01',
      date_from: '2026-09-01',
      date_to: '2026-09-30',
    });
    assert.equal((await validate(query)).length, 0);
    assert.equal(query.page, 2);
    assert.equal(query.limit, 50);

    const invalid = await errorsFor(ListTripsQueryDto, {
      limit: '500',
      date: '2026-02-30',
      date_from: '01-09-2026',
    });
    assert.deepEqual(invalid.map((error) => error.property).sort(), ['date', 'date_from', 'limit']);
  });

  it('rejects client-controlled tenant, crew and lifecycle fields through the global pipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    const forbidden: Array<[string, unknown]> = [
      ['school_id', SCHOOL_ID],
      ['route_id', ROUTE_ID],
      ['bus_id', ROUTE_ID],
      ['driver_id', ROUTE_ID],
      ['conductor_id', ROUTE_ID],
      ['status', TripStatus.COMPLETED],
      ['actual_start_at', '2026-09-01T06:30:00.000Z'],
      ['cancelled_at', '2026-09-01T06:30:00.000Z'],
    ];

    for (const [field, value] of forbidden) {
      await assert.rejects(
        pipe.transform(
          { ...VALID_BODY, [field]: value },
          { metatype: CreateTripDto, type: 'body', data: '' },
        ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          return true;
        },
      );
    }
  });

  it('rejects a cancelled_at override on the status endpoint too', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    await assert.rejects(
      pipe.transform(
        { status: TripStatus.CANCELLED, cancelled_at: '2026-09-01T06:30:00.000Z' },
        { metatype: UpdateTripStatusDto, type: 'body', data: '' },
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        return true;
      },
    );
  });
});

describe('shared trip validation schemas', () => {
  it('mirror the API DTO contract', () => {
    assert.equal(tripCreateSchema.safeParse(VALID_BODY).success, true);
    assert.equal(
      tripCreateSchema.safeParse({ ...VALID_BODY, school_id: SCHOOL_ID }).success,
      false,
    );
    assert.equal(
      tripCreateSchema.safeParse({
        ...VALID_BODY,
        scheduled_end_at: '2026-09-01T05:00:00.000Z',
      }).success,
      false,
    );
    assert.equal(tripUpdateSchema.safeParse({}).success, true);
    assert.equal(tripStatusUpdateSchema.safeParse({ status: TripStatus.BOARDING }).success, true);
    assert.equal(tripStatusUpdateSchema.safeParse({ status: 'DEPARTED' }).success, false);
    assert.equal(tripCancelSchema.safeParse({ cancellation_reason: 'Snow' }).success, true);
    assert.equal(
      tripListQuerySchema.safeParse({ date_from: '2026-09-05', date_to: '2026-09-01' }).success,
      false,
    );

    const parsed = tripListQuerySchema.parse({ page: '3', limit: '10' });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 10);
  });

  it('describes the lifecycle state machine', () => {
    assert.deepEqual(TRIP_STATUS_TRANSITIONS[TripStatus.SCHEDULED], [
      TripStatus.BOARDING,
      TripStatus.IN_PROGRESS,
      TripStatus.CANCELLED,
    ]);
    assert.deepEqual(TRIP_STATUS_TRANSITIONS[TripStatus.IN_PROGRESS], [
      TripStatus.COMPLETED,
      TripStatus.CANCELLED,
    ]);
    assert.deepEqual(TRIP_STATUS_TRANSITIONS[TripStatus.COMPLETED], []);
    assert.deepEqual(TRIP_STATUS_TRANSITIONS[TripStatus.CANCELLED], []);

    assert.equal(isTripStatusTransitionAllowed(TripStatus.SCHEDULED, TripStatus.IN_PROGRESS), true);
    assert.equal(isTripStatusTransitionAllowed(TripStatus.SCHEDULED, TripStatus.COMPLETED), false);
    assert.equal(isTripStatusTransitionAllowed(TripStatus.COMPLETED, TripStatus.CANCELLED), false);
    assert.equal(isTripStatusTransitionAllowed(TripStatus.CANCELLED, TripStatus.SCHEDULED), false);
  });
});
