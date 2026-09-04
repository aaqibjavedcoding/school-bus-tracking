import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  TripAttendanceStatus,
  TripStatus,
  type TripResponse,
  type TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import {
  groupManifestByStop,
  isTripOpen,
  manifestCounts,
  nextCrewTransitions,
  pickCrewTrip,
  transitionLabel,
} from './crew-trip.ts';

/**
 * Crew selectors: which of the day's runs the crew screen shows, which
 * lifecycle transitions the UI offers, and how the manifest is counted and
 * grouped. The transition table itself is shared with the server
 * (`@school-bus-tracking/validation`), so these tests pin the mobile UX to
 * the API's actual lifecycle rules.
 */
const trip = (overrides: Partial<TripResponse>): TripResponse => ({
  id: '11111111-1111-4111-8111-111111111111',
  school_id: '22222222-2222-4222-8222-222222222222',
  route_id: '33333333-3333-4333-8333-333333333333',
  bus_id: null,
  driver_id: '44444444-4444-4444-8444-444444444444',
  conductor_id: null,
  status: TripStatus.SCHEDULED,
  scheduled_start_at: '2026-08-29T07:00:00.000Z',
  scheduled_end_at: null,
  actual_start_at: null,
  actual_end_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: '2026-08-28T10:00:00.000Z',
  updated_at: '2026-08-28T10:00:00.000Z',
  ...overrides,
});

describe('pickCrewTrip', () => {
  it('prefers the active run over everything else', () => {
    const selected = pickCrewTrip([
      trip({
        id: 'a',
        status: TripStatus.COMPLETED,
        scheduled_start_at: '2026-08-29T06:00:00.000Z',
      }),
      trip({
        id: 'b',
        status: TripStatus.IN_PROGRESS,
        scheduled_start_at: '2026-08-29T07:30:00.000Z',
      }),
      trip({
        id: 'c',
        status: TripStatus.SCHEDULED,
        scheduled_start_at: '2026-08-29T07:00:00.000Z',
      }),
    ]);
    assert.equal(selected?.id, 'b');
  });

  it('falls back to the earliest scheduled run', () => {
    const selected = pickCrewTrip([
      trip({
        id: 'a',
        status: TripStatus.SCHEDULED,
        scheduled_start_at: '2026-08-29T15:00:00.000Z',
      }),
      trip({
        id: 'b',
        status: TripStatus.SCHEDULED,
        scheduled_start_at: '2026-08-29T07:00:00.000Z',
      }),
    ]);
    assert.equal(selected?.id, 'b');
  });

  it('reviews the latest finished run when nothing is open', () => {
    const selected = pickCrewTrip([
      trip({
        id: 'a',
        status: TripStatus.COMPLETED,
        scheduled_start_at: '2026-08-29T07:00:00.000Z',
      }),
      trip({
        id: 'b',
        status: TripStatus.CANCELLED,
        scheduled_start_at: '2026-08-29T15:00:00.000Z',
      }),
    ]);
    assert.equal(selected?.id, 'b');
  });

  it('returns null without trips', () => {
    assert.equal(pickCrewTrip([]), null);
  });
});

describe('nextCrewTransitions', () => {
  it('walks the forward lifecycle one step at a time', () => {
    assert.deepEqual(nextCrewTransitions(TripStatus.SCHEDULED), [
      TripStatus.BOARDING,
      TripStatus.IN_PROGRESS,
    ]);
    assert.deepEqual(nextCrewTransitions(TripStatus.BOARDING), [TripStatus.IN_PROGRESS]);
    assert.deepEqual(nextCrewTransitions(TripStatus.IN_PROGRESS), [TripStatus.COMPLETED]);
  });

  it('never offers cancellation to crew and offers nothing on terminal trips', () => {
    assert.equal(nextCrewTransitions(TripStatus.SCHEDULED).includes(TripStatus.CANCELLED), false);
    assert.deepEqual(nextCrewTransitions(TripStatus.COMPLETED), []);
    assert.deepEqual(nextCrewTransitions(TripStatus.CANCELLED), []);
  });
});

describe('transitionLabel', () => {
  it('labels the forward buttons', () => {
    assert.equal(transitionLabel(TripStatus.BOARDING), 'Start boarding');
    assert.equal(transitionLabel(TripStatus.IN_PROGRESS), 'Depart & drive');
    assert.equal(transitionLabel(TripStatus.COMPLETED), 'Complete trip');
  });
});

describe('manifestCounts / groupManifestByStop', () => {
  const entry = (id: string, stopId: string, stopName: string, status: TripAttendanceStatus) =>
    ({
      id: null,
      school_id: 's',
      trip_id: 't',
      student_id: id,
      admission_number: id.toUpperCase(),
      first_name: id,
      last_name: 'Test',
      grade_level: null,
      stop_id: stopId,
      stop_name: stopName,
      stop_sequence_number: stopId === 's1' ? 1 : 2,
      status,
      boarded_at: null,
      boarded_by: null,
      dropped_at: null,
      dropped_by: null,
      created_at: null,
      updated_at: null,
    }) as TripStudentAttendanceResponse;

  const items = [
    entry('a', 's1', 'First Stop', TripAttendanceStatus.BOARDED),
    entry('b', 's1', 'First Stop', TripAttendanceStatus.PENDING),
    entry('c', 's2', 'Second Stop', TripAttendanceStatus.DROPPED),
  ];

  it('counts attendance states over the manifest', () => {
    assert.deepEqual(manifestCounts(items), { total: 3, pending: 1, boarded: 1, dropped: 1 });
  });

  it('groups consecutive entries per stop', () => {
    const groups = groupManifestByStop(items);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.stop_name, 'First Stop');
    assert.deepEqual(
      groups[0]!.students.map((student) => student.student_id),
      ['a', 'b'],
    );
    assert.deepEqual(
      groups[1]!.students.map((student) => student.student_id),
      ['c'],
    );
  });
});

describe('isTripOpen', () => {
  it('treats boarding and in-progress as open', () => {
    assert.equal(isTripOpen(TripStatus.BOARDING), true);
    assert.equal(isTripOpen(TripStatus.IN_PROGRESS), true);
    assert.equal(isTripOpen(TripStatus.SCHEDULED), true);
    assert.equal(isTripOpen(TripStatus.COMPLETED), false);
    assert.equal(isTripOpen(TripStatus.CANCELLED), false);
  });
});
