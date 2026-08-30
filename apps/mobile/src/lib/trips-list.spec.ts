import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import {
  LIVE_FILTER,
  LIVE_STATUSES,
  tripMatchesSearch,
  tripMatchesStatusFilter,
  uniqueTripsById,
  visibleTrips,
} from './trips-list.ts';

/**
 * Guards for the Trips screen list-shaping rules: the rendered list must be
 * unique by trip id (stable React keys), honour the status chip, and match
 * free-text search over route, bus and crew — case-insensitively, partially
 * and across full names.
 */

function trip(overrides: Partial<TripResponse> & { id: string }): TripResponse {
  return {
    school_id: 'school',
    route_id: 'route',
    route_name: 'North Loop',
    route_code: 'R-1',
    bus_id: 'bus',
    bus_number: 'B-101',
    registration_number: 'REG-101',
    driver_id: 'driver',
    driver_name: 'Ada Lovelace',
    conductor_id: 'conductor',
    conductor_name: 'Marie Curie',
    status: TripStatus.BOARDING,
    scheduled_start_at: '2026-08-30T06:00:00.000Z',
    scheduled_end_at: null,
    actual_start_at: null,
    actual_end_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as TripResponse;
}

describe('uniqueTripsById', () => {
  it('keeps the first occurrence and preserves order', () => {
    const a = trip({ id: 'a' });
    const b = trip({ id: 'b' });
    const aAgain = trip({ id: 'a', status: TripStatus.IN_PROGRESS });
    const result = uniqueTripsById([a, b, aAgain]);
    assert.deepEqual(result, [a, b]);
  });

  it('drops trips duplicated by a Live merge race (same id in both status pages)', () => {
    // A trip transitions BOARDING -> IN_PROGRESS between the two parallel
    // requests, so both responses contain the same id.
    const boarding = trip({ id: 'same', status: TripStatus.BOARDING });
    const inProgress = trip({ id: 'same', status: TripStatus.IN_PROGRESS });
    const merged = [...LIVE_STATUSES.map(() => []), [boarding, inProgress]].flat();
    assert.equal(uniqueTripsById(merged).length, 1);
  });

  it('returns an empty list for empty input without creating keys', () => {
    assert.deepEqual(uniqueTripsById([]), []);
  });
});

describe('tripMatchesStatusFilter', () => {
  const boarding = trip({ id: 'a', status: TripStatus.BOARDING });

  it('accepts everything for the "all" chip', () => {
    for (const status of Object.values(TripStatus)) {
      assert.equal(tripMatchesStatusFilter(trip({ id: 'x', status }), ''), true);
    }
    assert.equal(tripMatchesStatusFilter(boarding, ''), true);
  });

  it('matches only the selected status for single-status chips', () => {
    assert.equal(tripMatchesStatusFilter(boarding, TripStatus.BOARDING), true);
    assert.equal(tripMatchesStatusFilter(boarding, TripStatus.SCHEDULED), false);
  });

  it('aggregates boarding and in progress for the Live chip', () => {
    assert.deepEqual([...LIVE_STATUSES], [TripStatus.BOARDING, TripStatus.IN_PROGRESS]);
    assert.equal(tripMatchesStatusFilter(boarding, LIVE_FILTER), true);
    assert.equal(
      tripMatchesStatusFilter(trip({ id: 'b', status: TripStatus.IN_PROGRESS }), LIVE_FILTER),
      true,
    );
    assert.equal(
      tripMatchesStatusFilter(trip({ id: 'c', status: TripStatus.SCHEDULED }), LIVE_FILTER),
      false,
    );
    assert.equal(
      tripMatchesStatusFilter(trip({ id: 'd', status: TripStatus.COMPLETED }), LIVE_FILTER),
      false,
    );
  });
});

describe('tripMatchesSearch', () => {
  const row = trip({ id: 'a' });

  it('matches route names and codes case-insensitively and partially', () => {
    for (const term of ['North', 'north', 'NORTH', 'North Loop', 'r-1', 'R-1', 'loop']) {
      assert.equal(tripMatchesSearch(row, term), true, `expected match for "${term}"`);
    }
    assert.equal(tripMatchesSearch(row, 'South'), false);
  });

  it('matches bus numbers and registration numbers', () => {
    for (const term of ['B-101', 'b-1', '101', 'REG-101', 'reg']) {
      assert.equal(tripMatchesSearch(row, term), true, `expected match for "${term}"`);
    }
  });

  it('matches driver and conductor names, including full names with a space', () => {
    // The server predicate compares one term against first_name or last_name
    // separately, so the full displayed name must still match client-side.
    for (const term of ['Ada', 'ada lovelace', 'Lovelace', 'Marie Curie', 'curie']) {
      assert.equal(tripMatchesSearch(row, term), true, `expected match for "${term}"`);
    }
  });

  it('treats blank searches as matching everything', () => {
    assert.equal(tripMatchesSearch(row, ''), true);
    assert.equal(tripMatchesSearch(row, '   '), true);
  });

  it('does not match unrelated terms', () => {
    assert.equal(tripMatchesSearch(row, 'zzz'), false);
    assert.equal(tripMatchesSearch(row, 'South Loop'), false);
  });

  it('is resilient to missing optional fields', () => {
    const sparse = trip({
      id: 'b',
      route_name: null,
      route_code: null,
      bus_number: null,
      registration_number: null,
      driver_name: null,
      conductor_name: null,
    });
    assert.equal(tripMatchesSearch(sparse, 'north'), false);
    assert.equal(tripMatchesSearch(sparse, ''), true);
  });
});

describe('visibleTrips', () => {
  const rows = [
    trip({ id: 'scheduled', status: TripStatus.SCHEDULED }),
    trip({ id: 'boarding', status: TripStatus.BOARDING }),
    trip({ id: 'in-progress', status: TripStatus.IN_PROGRESS, driver_name: 'Grace Hopper' }),
    trip({ id: 'completed', status: TripStatus.COMPLETED }),
  ];

  it('combines status chip, search and de-duplication', () => {
    // Live chip + search for the driver: unique, live-only, matching rows.
    assert.deepEqual(
      visibleTrips(rows, LIVE_FILTER, 'grace').map((t) => t.id),
      ['in-progress'],
    );
    // Scheduled chip: no client-side search term keeps only scheduled rows.
    assert.deepEqual(
      visibleTrips(rows, TripStatus.SCHEDULED, '').map((t) => t.id),
      ['scheduled'],
    );
    // All statuses, empty search: everything, once.
    assert.equal(visibleTrips(rows, '', '').length, 4);
  });

  it('renders each duplicated id once when the Live merge overlaps', () => {
    const duplicated = [...rows, trip({ id: 'boarding', status: TripStatus.IN_PROGRESS })];
    const visible = visibleTrips(duplicated, LIVE_FILTER, '');
    assert.deepEqual(
      visible.map((t) => t.id),
      ['boarding', 'in-progress'],
    );
  });

  it('returns an empty list when nothing matches (drives the no-results state)', () => {
    assert.deepEqual(visibleTrips(rows, '', 'zzz'), []);
    assert.deepEqual(visibleTrips(rows, TripStatus.CANCELLED, ''), []);
  });
});
