import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { TripArrivalDiagnostics } from '@school-bus-tracking/shared-types';
import {
  OFFLINE_FALLBACK_MIN_RADIUS_METERS,
  arrivalHoldReason,
  arrivalZoneOfStop,
  arrivalZoneStatus,
  distanceToStopMeters,
  effectiveArrivalRadiusMeters,
  stopById,
} from './arrival-zone.ts';

/**
 * Deep-fix R1 — the client's arrival-zone math.
 *
 * Everything here reads the SERVER's `effective_radius_meters`: the map's
 * circle, the card's "inside arrival
 * zone" pill and the held-reason line must agree with the circle the arrival
 * engine actually evaluates, or the driver is shown a gate they cannot see
 * the edges of. The indicator is display-only — these specs also pin that
 * the functions are pure geometry/derivation with no side effects to feed
 * back.
 */

/** ~1° latitude ≈ 111.1 km; 0.001° north of the base point is ~111 m. */
const BASE = { latitude: 40.7, longitude: -74.0 };
const ABOUT_20M_NORTH = { latitude: 40.70018, longitude: -74.0 };
const ABOUT_40M_NORTH = { latitude: 40.70036, longitude: -74.0 };
const ABOUT_120M_NORTH = { latitude: 40.70108, longitude: -74.0 };

/**
 * A stop as the SERVER sends it: the stored radius plus the effective radius
 * the arrival engine uses. `effectiveRadius` defaults to the server's 25 m
 * floor applied to the stored value.
 */
const stopWith = (radius: number, coords = BASE, effectiveRadius = Math.max(radius, 25)) => ({
  latitude: coords.latitude,
  longitude: coords.longitude,
  geofence_radius_meters: radius,
  effective_radius_meters: effectiveRadius,
});

/** A stop cached before the server carried `effective_radius_meters`. */
const legacyStopWith = (radius: number, coords = BASE) => ({
  latitude: coords.latitude,
  longitude: coords.longitude,
  geofence_radius_meters: radius,
});

describe('effectiveArrivalRadiusMeters', () => {
  it('uses the radius the SERVER computed, whatever it is', () => {
    assert.equal(effectiveArrivalRadiusMeters(stopWith(10, BASE, 25)), 25);
    assert.equal(effectiveArrivalRadiusMeters(stopWith(120, BASE, 120)), 120);
    // The server env moved the floor: the app draws the new number, unchanged
    // and unfloored by any client constant.
    assert.equal(effectiveArrivalRadiusMeters(stopWith(10, BASE, 40)), 40);
  });

  it('falls back to max(stored, offline floor) only for a pre-field cached row', () => {
    assert.equal(effectiveArrivalRadiusMeters(legacyStopWith(10)), OFFLINE_FALLBACK_MIN_RADIUS_METERS);
    assert.equal(effectiveArrivalRadiusMeters(legacyStopWith(0)), OFFLINE_FALLBACK_MIN_RADIUS_METERS);
    assert.equal(effectiveArrivalRadiusMeters(legacyStopWith(120)), 120);
  });

  it('never returns NaN for garbage input', () => {
    assert.ok(Number.isFinite(effectiveArrivalRadiusMeters(legacyStopWith(Number.NaN))));
    assert.equal(
      effectiveArrivalRadiusMeters(legacyStopWith(Number.NaN)),
      OFFLINE_FALLBACK_MIN_RADIUS_METERS,
    );
    assert.equal(effectiveArrivalRadiusMeters(null), OFFLINE_FALLBACK_MIN_RADIUS_METERS);
  });
});

describe('arrivalZoneOfStop', () => {
  it('builds the zone from the surveyed stop with the effective radius', () => {
    const zone = arrivalZoneOfStop(stopWith(10));
    assert.deepEqual(zone?.center, BASE);
    assert.equal(zone?.radiusMeters, 25);
    assert.equal(arrivalZoneOfStop(stopWith(120))?.radiusMeters, 120);
  });

  it('returns null for an unsurveyed stop — nothing honest to draw', () => {
    assert.equal(
      arrivalZoneOfStop({
        latitude: null,
        longitude: null,
        geofence_radius_meters: 100,
        effective_radius_meters: 100,
      }),
      null,
    );
    assert.equal(arrivalZoneOfStop(null), null);
  });
});

describe('arrivalZoneStatus', () => {
  it('a fix 20 m from a 10 m stop is INSIDE the effective circle', () => {
    // The original field defect: the stored 10 m circle would say "outside"
    // (20 > 10) and the driver watches a parked bus never arrive. The
    // server's 25 m effective circle says inside, matching what it records.
    assert.equal(arrivalZoneStatus(ABOUT_20M_NORTH, stopWith(10)), 'inside');
  });

  it('a fix 40 m out is outside a 25 m effective circle — the zone is no longer 50 m', () => {
    assert.equal(arrivalZoneStatus(ABOUT_40M_NORTH, stopWith(10)), 'outside');
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
      arrivalZoneStatus(ABOUT_40M_NORTH, {
        latitude: null,
        longitude: null,
        geofence_radius_meters: 100,
        effective_radius_meters: 100,
      }),
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

describe('distanceToStopMeters — the number the next-stop card always shows', () => {
  it('measures straight-line metres with the engine\'s haversine', () => {
    const meters = distanceToStopMeters(ABOUT_20M_NORTH, stopWith(30));
    assert.ok(meters !== null && meters > 15 && meters < 25, `got ${String(meters)}`);
  });

  it('is 0 at the stop itself', () => {
    assert.equal(Math.round(distanceToStopMeters(BASE, stopWith(30)) ?? -1), 0);
  });

  it('is null without a fix or without surveyed coordinates', () => {
    assert.equal(distanceToStopMeters(null, stopWith(30)), null);
    assert.equal(distanceToStopMeters(ABOUT_20M_NORTH, null), null);
    assert.equal(
      distanceToStopMeters(ABOUT_20M_NORTH, {
        latitude: null,
        longitude: null,
        geofence_radius_meters: 100,
        effective_radius_meters: 100,
      }),
      null,
    );
  });
});
