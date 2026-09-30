import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS,
  arrivalMinEffectiveRadiusMeters,
  effectiveArrivalRadiusMeters,
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
  const original = process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];

  afterEach(() => {
    if (original === undefined) delete process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'];
    else process.env['ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS'] = original;
  });

  it('defaults to 25 m — small enough to draw honestly, large enough to detect', () => {
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
