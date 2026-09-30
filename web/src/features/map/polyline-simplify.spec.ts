import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRAIL_SIMPLIFY_TOLERANCE_METERS, simplifyPolylineMeters } from './polyline-simplify.ts';

/**
 * The web trail decimation, pinned (the mobile twin carries the same suite):
 * endpoints survive, beyond-tolerance deviations survive, sub-tolerance
 * jitter is dropped, the output is an order-preserving subset, and the metre
 * tolerance is latitude-independent.
 */

/** Metres of latitude per 0.00001°. */
const M = 111_320;

describe('simplifyPolylineMeters (web)', () => {
  it('keeps both endpoints and drops only sub-tolerance wiggle', () => {
    const line: Array<[number, number]> = [
      [72.8777, 19.076],
      [72.8777, 19.076 + 2 / M], // ~1.2 m off the chord
      [72.88, 19.079],
      [72.883, 19.082],
    ];
    assert.deepEqual(simplifyPolylineMeters(line, TRAIL_SIMPLIFY_TOLERANCE_METERS), [
      [72.8777, 19.076],
      [72.88, 19.079],
      [72.883, 19.082],
    ]);
  });

  it('drops the jitter a bus parked at a stop produces', () => {
    const parked: Array<[number, number]> = [
      [72.8777, 19.076],
      [72.8777, 19.076 + 1 / M],
      [72.8777, 19.076 - 1 / M],
      [72.8777, 19.076 + 2 / M],
    ];
    assert.deepEqual(simplifyPolylineMeters(parked, 5), [
      [72.8777, 19.076],
      [72.8777, 19.076 + 2 / M],
    ]);
  });

  it('keeps a hairpin apex however loose the tolerance', () => {
    const hairpin: Array<[number, number]> = [
      [72.8, 19.0],
      [72.8 + 100 / (111_320 * Math.cos((19.0 * Math.PI) / 180)), 19.0],
      [72.8, 19.0],
    ];
    assert.deepEqual(simplifyPolylineMeters(hairpin, 5), hairpin);
  });

  it('is latitude-independent (metres, not degrees)', () => {
    const offsetDeg = 0.0001;
    const build = (latitude: number): Array<[number, number]> => [
      [20.0, latitude],
      [20.0 + offsetDeg, latitude],
      [20.0, latitude + 0.001],
    ];
    assert.equal(simplifyPolylineMeters(build(19), 5).length, 3); // ~10.5 m, kept
    assert.equal(simplifyPolylineMeters(build(65), 5).length, 2); // ~4.7 m, dropped
  });

  it('returns short lines unchanged as a copy, and never reorders points', () => {
    const two: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    const copy = simplifyPolylineMeters(two, 5);
    assert.deepEqual(copy, two);
    assert.notEqual(copy, two);
    assert.deepEqual(simplifyPolylineMeters([], 5), []);
  });
});
