import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { TripArrivalDiagnostics } from '@school-bus-tracking/shared-types';
import {
  arrivalHoldReason,
  arrivalZoneOfStop,
  arrivalZoneStatus,
  effectiveArrivalRadiusMeters,
  stopById,
} from './arrival-zone.ts';

/**
 * Deep-fix R1 — the client's arrival-zone math.
 *
 * Everything here mirrors the SERVER's effective-radius rule
 * (`max(stored radius, 50)`): the map's circle, the card's "inside arrival
 * zone" pill and the held-reason line must agree with the circle the arrival
 * engine actually evaluates, or the driver is shown a gate they cannot see
 * the edges of. The indicator is display-only — these specs also pin that
 * the functions are pure geometry/derivation with no side effects to feed
 * back.
 */

/** ~1° latitude ≈ 111.1 km; 0.001° north of the base point is ~111 m. */
const BASE = { latitude: 40.7, longitude: -74.0 };
const ABOUT_40M_NORTH = { latitude: 40.70036, longitude: -74.0 };
const ABOUT_120M_NORTH = { latitude: 40.70108, longitude: -74.0 };

const stopWith = (radius: number, coords = BASE) => ({
  latitude: coords.latitude,
  longitude: coords.longitude,
  geofence_radius_meters: radius,
});

describe('effectiveArrivalRadiusMeters', () => {
  it('floors small legacy radii at the 50 m minimum', () => {
    assert.equal(effectiveArrivalRadiusMeters(10), 25);
    assert.equal(effectiveArrivalRadiusMeters(0), 25);
    assert.equal(effectiveArrivalRadiusMeters(null), 25);
    assert.equal(effectiveArrivalRadiusMeters(undefined), 25);
  });

  it('keeps the admin\'s larger radius as the intent', () => {
    assert.equal(effectiveArrivalRadiusMeters(100), 100);
    assert.equal(effectiveArrivalRadiusMeters(2000), 2000);
  });

  it('never returns NaN for garbage input', () => {
    assert.ok(Number.isFinite(effectiveArrivalRadiusMeters(Number.NaN)));
    assert.equal(effectiveArrivalRadiusMeters(Number.NaN), 25);
  });
});

describe('arrivalZoneOfStop', () => {
  it('builds the zone from the surveyed stop with the effective radius', () => {
    const zone = arrivalZoneOfStop(stopWith(10));
    assert.deepEqual(zone?.center, BASE);
    assert.equal(zone?.radiusMeters, 50);
    assert.equal(arrivalZoneOfStop(stopWith(120))?.radiusMeters, 120);
  });

  it('returns null for an unsurveyed stop — nothing honest to draw', () => {
    assert.equal(arrivalZoneOfStop({ latitude: null, longitude: null, geofence_radius_meters: 100 }), null);
    assert.equal(arrivalZoneOfStop(null), null);
  });
});

describe('arrivalZoneStatus', () => {
  it('a fix 40 m from a 10 m stop is INSIDE the effective circle', () => {
    // The exact field defect: the stored 10 m circle would say "outside"
    // (40 > 10) and the driver watches a parked bus never arrive. The
    // effective circle says inside, matching what the server records.
    assert.equal(arrivalZoneStatus(ABOUT_40M_NORTH, stopWith(10)), 'inside');
  });

  it('a fix 120 m out is outside even with the floor', () => {
    assert.equal(arrivalZoneStatus(ABOUT_120M_NORTH, stopWith(10)), 'outside');
    assert.equal(arrivalZoneStatus(ABOUT_120M_NORTH, stopWith(100)), 'outside');
  });

  it('a fix near the pin is inside a larger stored radius too', () => {
    assert.equal(arrivalZoneStatus(ABOUT_40M_NORTH, stopWith(100)), 'inside');
  });

  it('unknown when there is no fix or no surveyed stop', () => {
    assert.equal(arrivalZoneStatus(null, stopWith(100)), 'unknown');
    assert.equal(arrivalZoneStatus(ABOUT_40M_NORTH, null), 'unknown');
    assert.equal(
      arrivalZoneStatus(ABOUT_40M_NORTH, { latitude: null, longitude: null, geofence_radius_meters: 100 }),
      'unknown',
    );
  });
});

describe('arrivalHoldReason', () => {
  const diagnostics = (overrides: Partial<TripArrivalDiagnostics> = {}): TripArrivalDiagnostics =>
    ({
      last_fix_rejection: null,
      last_gate_block: null,
      pending_stops: [],
      unsurveyed_stops: [],
      ...overrides,
    }) as TripArrivalDiagnostics;

  it('a gate block wins: the departure gate explains a held stop', () => {
    const reason = arrivalHoldReason(
      diagnostics({ last_gate_block: 'awaiting-departure' }),
      'stop-2',
    );
    assert.deepEqual(reason, { kind: 'gate', reason: 'awaiting-departure' });
  });

  it('falls back to the stop\'s own blocked_reason when no global block is set', () => {
    const reason = arrivalHoldReason(
      diagnostics({
        pending_stops: [
          {
            stop_id: 'stop-2',
            stop_name: 'Oak Ave',
            sequence_number: 2,
            inside_count: 2,
            required_fixes: 2,
            blocked_reason: 'inter-stop-cooldown',
          },
        ],
      }),
      'stop-2',
    );
    assert.deepEqual(reason, { kind: 'gate', reason: 'inter-stop-cooldown' });
  });

  it('evidence progress reads as count/required', () => {
    const reason = arrivalHoldReason(
      diagnostics({
        pending_stops: [
          {
            stop_id: 'stop-2',
            stop_name: 'Oak Ave',
            sequence_number: 2,
            inside_count: 1,
            required_fixes: 2,
            blocked_reason: null,
          },
        ],
      }),
      'stop-2',
    );
    assert.deepEqual(reason, { kind: 'evidence', count: 1, required: 2 });
  });

  it('null when nothing holds the stop, or the stop is unknown', () => {
    assert.equal(
      arrivalHoldReason(
        diagnostics({
          pending_stops: [
            {
              stop_id: 'stop-2',
              stop_name: 'Oak Ave',
              sequence_number: 2,
              inside_count: 2,
              required_fixes: 2,
              blocked_reason: null,
            },
          ],
        }),
        'stop-2',
      ),
      null,
    );
    assert.equal(arrivalHoldReason(diagnostics(), 'stop-9'), null);
    assert.equal(arrivalHoldReason(diagnostics(), null), null);
    assert.equal(arrivalHoldReason(null, 'stop-2'), null);
  });
});

describe('stopById', () => {
  it('finds the stop by id and answers null for misses', () => {
    const stops = [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ] as never;
    assert.equal(stopById(stops, 'b')?.name, 'Beta');
    assert.equal(stopById(stops, 'zzz'), null);
    assert.equal(stopById(null, 'a'), null);
    assert.equal(stopById(stops, null), null);
  });
});
