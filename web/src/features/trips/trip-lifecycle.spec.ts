import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import {
  buildTripLifecycleSteps,
  canActAsCrewOnTrip,
  tripLifecycleCancellation,
} from '@school-bus-tracking/validation';

const trip = (over: Record<string, unknown> = {}) =>
  ({
    status: TripStatus.SCHEDULED,
    scheduled_start_at: '2026-09-30T07:00:00.000Z',
    actual_start_at: null,
    actual_end_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    driver_id: 'driver-1',
    conductor_id: 'conductor-1',
    ...over,
  }) as never;

describe('canActAsCrewOnTrip', () => {
  test('the assigned driver and conductor may act', () => {
    assert.equal(canActAsCrewOnTrip({ id: 'driver-1', role: UserRole.DRIVER }, trip()), true);
    assert.equal(
      canActAsCrewOnTrip({ id: 'conductor-1', role: UserRole.CONDUCTOR }, trip()),
      true,
    );
  });

  test('a school admin never gets the crew buttons, even though the API allows the PATCH', () => {
    assert.equal(
      canActAsCrewOnTrip({ id: 'admin-1', role: UserRole.SCHOOL_ADMIN }, trip()),
      false,
    );
  });

  test('crew assigned to a different trip may not act', () => {
    assert.equal(canActAsCrewOnTrip({ id: 'driver-2', role: UserRole.DRIVER }, trip()), false);
  });

  test('missing user, trip or id is never crew', () => {
    assert.equal(canActAsCrewOnTrip(null, trip()), false);
    assert.equal(canActAsCrewOnTrip({ id: 'driver-1', role: UserRole.DRIVER }, null), false);
    assert.equal(canActAsCrewOnTrip({ id: null, role: UserRole.DRIVER }, trip()), false);
    assert.equal(
      canActAsCrewOnTrip({ id: 'x', role: UserRole.DRIVER }, trip({ driver_id: null })),
      false,
    );
  });

  test('parents are not crew', () => {
    assert.equal(canActAsCrewOnTrip({ id: 'driver-1', role: UserRole.PARENT }, trip()), false);
  });
});

describe('buildTripLifecycleSteps', () => {
  test('a scheduled trip highlights Scheduled and carries its scheduled time', () => {
    const steps = buildTripLifecycleSteps(trip());
    assert.deepEqual(
      steps.map((step) => step.status),
      [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS, TripStatus.COMPLETED],
    );
    assert.equal(steps[0].current, true);
    assert.equal(steps[0].at, '2026-09-30T07:00:00.000Z');
    assert.deepEqual(
      steps.map((step) => step.reached),
      [true, false, false, false],
    );
  });

  test('an in-progress trip marks the earlier steps reached and stamps the start', () => {
    const steps = buildTripLifecycleSteps(
      trip({ status: TripStatus.IN_PROGRESS, actual_start_at: '2026-09-30T07:05:00.000Z' }),
    );
    assert.deepEqual(
      steps.map((step) => step.reached),
      [true, true, true, false],
    );
    assert.equal(steps[2].current, true);
    assert.equal(steps[2].at, '2026-09-30T07:05:00.000Z');
  });

  test('a completed trip reaches every step and stamps the end', () => {
    const steps = buildTripLifecycleSteps(
      trip({
        status: TripStatus.COMPLETED,
        actual_start_at: '2026-09-30T07:05:00.000Z',
        actual_end_at: '2026-09-30T07:55:00.000Z',
      }),
    );
    assert.ok(steps.every((step) => step.reached));
    assert.equal(steps[3].current, true);
    assert.equal(steps[3].at, '2026-09-30T07:55:00.000Z');
  });

  test('a cancelled trip keeps the progress it actually made and highlights nothing forward', () => {
    const steps = buildTripLifecycleSteps(
      trip({
        status: TripStatus.CANCELLED,
        actual_start_at: '2026-09-30T07:05:00.000Z',
        cancelled_at: '2026-09-30T07:20:00.000Z',
        cancellation_reason: 'Bus broke down',
      }),
    );
    assert.deepEqual(
      steps.map((step) => step.reached),
      [true, true, true, false],
    );
    assert.ok(steps.every((step) => !step.current));
  });
});

describe('tripLifecycleCancellation', () => {
  test('is null unless the trip was cancelled', () => {
    assert.equal(tripLifecycleCancellation(trip()), null);
  });

  test('returns the terminal branch with its reason', () => {
    assert.deepEqual(
      tripLifecycleCancellation(
        trip({
          status: TripStatus.CANCELLED,
          cancelled_at: '2026-09-30T07:20:00.000Z',
          cancellation_reason: 'Bus broke down',
        }),
      ),
      { at: '2026-09-30T07:20:00.000Z', reason: 'Bus broke down' },
    );
  });
});
