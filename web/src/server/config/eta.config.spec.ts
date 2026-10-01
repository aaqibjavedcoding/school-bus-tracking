import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS,
  STOP_DEFAULT_GEOFENCE_RADIUS_METERS,
  STOP_MAX_GEOFENCE_RADIUS_METERS,
  STOP_MIN_GEOFENCE_RADIUS_METERS,
  arrivalMinEffectiveRadiusMeters,
  effectiveArrivalRadiusMeters,
  stopDefaultGeofenceRadiusMeters,
} from './eta.config';

/**
 * The arrival-zone floor is ONE constant, and the apps draw what it produces.
 *
 * These cases pin the two properties the "the circle is far too large" fix
 * depends on: the floor is 25 m (not the old 50, and emphatically not 5 —
 * see the docblock in `eta.config.ts`), and `effective_radius_meters` moves
 * with the deployment's env so a client can never mirror it wrongly.
 */
describe('arrival effective radius (single source of truth)', () => {
  const originalArrivalFloor = process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];
  const originalStopDefault = process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'];

  afterEach(() => {
    if (originalArrivalFloor === undefined)
      delete process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];
    else process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'] = originalArrivalFloor;

    if (originalStopDefault === undefined)
      delete process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'];
    else process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'] = originalStopDefault;
  });

  it('defaults the stored stop radius to 20 m while keeping detection/drawing effective', () => {
    delete process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'];
    delete process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];

    assert.equal(STOP_MIN_GEOFENCE_RADIUS_METERS, 20);
    assert.equal(STOP_DEFAULT_GEOFENCE_RADIUS_METERS, 20);
    assert.equal(stopDefaultGeofenceRadiusMeters(), 20);
    // Stored default is 20 m, but the detection/display radius remains the
    // effective server value: max(stored, ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS).
    assert.equal(effectiveArrivalRadiusMeters(stopDefaultGeofenceRadiusMeters()), 25);
  });

  it('clamps an env default below validation so omitted-radius creates still save', () => {
    process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'] = '5';
    assert.equal(stopDefaultGeofenceRadiusMeters(), STOP_MIN_GEOFENCE_RADIUS_METERS);
  });

  it('allows deployments to raise the default stored stop radius deliberately', () => {
    process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'] = '35';
    assert.equal(stopDefaultGeofenceRadiusMeters(), 35);
    assert.equal(effectiveArrivalRadiusMeters(stopDefaultGeofenceRadiusMeters()), 35);
  });

  it('clamps an env default above validation so omitted-radius creates stay editable', () => {
    process.env['STOP_DEFAULT_GEOFENCE_RADIUS_METERS'] = '5000';
    assert.equal(stopDefaultGeofenceRadiusMeters(), STOP_MAX_GEOFENCE_RADIUS_METERS);
  });

  it('defaults the effective floor to 25 m — small enough to draw honestly, large enough to detect', () => {
    delete process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];
    assert.equal(ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS, 25);
    assert.equal(arrivalMinEffectiveRadiusMeters(), 25);
    // A typical 15 m phone fix must still satisfy accuracy <= effectiveRadius,
    // which is the whole reason the floor is not 5 m.
    assert.ok(15 <= arrivalMinEffectiveRadiusMeters());
  });

  it('floors a small stored radius and passes a larger one through', () => {
    delete process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];
    assert.equal(effectiveArrivalRadiusMeters(15), 25);
    assert.equal(effectiveArrivalRadiusMeters(20), 25);
    assert.equal(effectiveArrivalRadiusMeters(25), 25);
    assert.equal(effectiveArrivalRadiusMeters(120), 120);
  });

  it('degrades garbage to the floor rather than NaN', () => {
    delete process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];
    assert.equal(effectiveArrivalRadiusMeters(null), 25);
    assert.equal(effectiveArrivalRadiusMeters(undefined), 25);
    assert.equal(effectiveArrivalRadiusMeters(Number.NaN), 25);
    assert.equal(effectiveArrivalRadiusMeters(-10), 25);
  });

  it('follows the env, so changing the deployment changes what the app draws', () => {
    process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'] = '40';
    assert.equal(arrivalMinEffectiveRadiusMeters(), 40);
    assert.equal(effectiveArrivalRadiusMeters(15), 40);
    assert.equal(effectiveArrivalRadiusMeters(120), 120);
  });
});
