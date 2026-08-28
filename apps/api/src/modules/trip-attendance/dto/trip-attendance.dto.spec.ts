import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TripAttendanceStatus, TripStatus } from '@school-bus-tracking/shared-types';
import {
  TRIP_ATTENDANCE_OPEN_TRIP_STATUSES,
  TRIP_ATTENDANCE_STATUS_TRANSITIONS,
  isTripAttendanceTransitionAllowed,
  isTripOpenForAttendance,
  tripStudentBoardSchema,
  tripStudentDropSchema,
  tripStudentManifestQuerySchema,
} from '@school-bus-tracking/validation';
import { ListTripStudentsQueryDto } from './list-trip-students-query.dto';

const STOP_ID = '11111111-1111-4111-8111-111111111111';

async function errorsFor<T extends object>(type: new () => T, body: Record<string, unknown>) {
  return validate(plainToInstance(type, body));
}

describe('trip attendance DTO validation', () => {
  it('accepts an empty manifest query and both filters', async () => {
    assert.equal((await errorsFor(ListTripStudentsQueryDto, {})).length, 0);
    assert.equal(
      (
        await errorsFor(ListTripStudentsQueryDto, {
          status: TripAttendanceStatus.BOARDED,
          stop_id: STOP_ID,
        })
      ).length,
      0,
    );
  });

  it('rejects an unknown attendance status and a malformed stop id', async () => {
    const errors = await errorsFor(ListTripStudentsQueryDto, {
      status: 'ABSENT',
      stop_id: 'not-a-uuid',
    });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['status', 'stop_id']);
  });

  it('rejects any tenant, trip, crew or timestamp field in the query string', async () => {
    // Same pipe configuration as `main.ts`: unknown properties are rejected,
    // never silently stripped.
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    const forbidden: Array<[string, unknown]> = [
      ['school_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      ['trip_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      ['student_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      ['boarded_at', '2026-09-01T06:31:00.000Z'],
      ['boarded_by', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
      ['route_id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
    ];

    for (const [field, value] of forbidden) {
      await assert.rejects(
        pipe.transform({ [field]: value }, { metatype: ListTripStudentsQueryDto, type: 'query' }),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          return true;
        },
      );
    }

    const accepted = await pipe.transform(
      { status: TripAttendanceStatus.PENDING, stop_id: STOP_ID },
      { metatype: ListTripStudentsQueryDto, type: 'query' },
    );
    assert.deepEqual({ ...accepted }, { status: TripAttendanceStatus.PENDING, stop_id: STOP_ID });
  });
});

describe('trip attendance validation schemas', () => {
  it('accepts the empty board/drop payloads and rejects any smuggled field', () => {
    assert.deepEqual(tripStudentBoardSchema.parse({}), {});
    assert.deepEqual(tripStudentDropSchema.parse({}), {});

    for (const schema of [tripStudentBoardSchema, tripStudentDropSchema]) {
      for (const body of [
        { school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { boarded_at: '2026-09-01T06:31:00.000Z' },
        { boarded_by: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        { student_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      ]) {
        assert.equal(schema.safeParse(body).success, false);
      }
    }
  });

  it('validates the manifest query and rejects unknown keys', () => {
    assert.equal(tripStudentManifestQuerySchema.safeParse({}).success, true);
    assert.equal(
      tripStudentManifestQuerySchema.safeParse({
        status: TripAttendanceStatus.DROPPED,
        stop_id: STOP_ID,
      }).success,
      true,
    );
    assert.equal(tripStudentManifestQuerySchema.safeParse({ status: 'DEBOARDED' }).success, false);
    assert.equal(tripStudentManifestQuerySchema.safeParse({ stop_id: 'nope' }).success, false);
    assert.equal(tripStudentManifestQuerySchema.safeParse({ school_id: STOP_ID }).success, false);
  });

  it('allows only the one-way PENDING → BOARDED → DROPPED progression', () => {
    assert.deepEqual(TRIP_ATTENDANCE_STATUS_TRANSITIONS[TripAttendanceStatus.PENDING], [
      TripAttendanceStatus.BOARDED,
    ]);
    assert.deepEqual(TRIP_ATTENDANCE_STATUS_TRANSITIONS[TripAttendanceStatus.BOARDED], [
      TripAttendanceStatus.DROPPED,
    ]);
    assert.deepEqual(TRIP_ATTENDANCE_STATUS_TRANSITIONS[TripAttendanceStatus.DROPPED], []);

    assert.equal(
      isTripAttendanceTransitionAllowed(TripAttendanceStatus.PENDING, TripAttendanceStatus.BOARDED),
      true,
    );
    assert.equal(
      isTripAttendanceTransitionAllowed(TripAttendanceStatus.BOARDED, TripAttendanceStatus.DROPPED),
      true,
    );
    // Duplicate boarding, drop before board and duplicate drop.
    assert.equal(
      isTripAttendanceTransitionAllowed(TripAttendanceStatus.BOARDED, TripAttendanceStatus.BOARDED),
      false,
    );
    assert.equal(
      isTripAttendanceTransitionAllowed(TripAttendanceStatus.PENDING, TripAttendanceStatus.DROPPED),
      false,
    );
    assert.equal(
      isTripAttendanceTransitionAllowed(TripAttendanceStatus.DROPPED, TripAttendanceStatus.DROPPED),
      false,
    );
  });

  it('keeps attendance open only while the trip is not terminal', () => {
    assert.deepEqual(TRIP_ATTENDANCE_OPEN_TRIP_STATUSES, [
      TripStatus.SCHEDULED,
      TripStatus.BOARDING,
      TripStatus.IN_PROGRESS,
    ]);
    assert.equal(isTripOpenForAttendance(TripStatus.SCHEDULED), true);
    assert.equal(isTripOpenForAttendance(TripStatus.BOARDING), true);
    assert.equal(isTripOpenForAttendance(TripStatus.IN_PROGRESS), true);
    assert.equal(isTripOpenForAttendance(TripStatus.COMPLETED), false);
    assert.equal(isTripOpenForAttendance(TripStatus.CANCELLED), false);
  });
});
