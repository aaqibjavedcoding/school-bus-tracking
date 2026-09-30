import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TRAIL_SIMPLIFY_TOLERANCE_METERS,
  decimateTrailLine,
  simplifyPolylineMeters,
} from './polyline-simplify.ts';

/**
 * The trail decimation, pinned:
 *
 * - endpoints survive unconditionally (the trail still starts where the trip
 *   started and ends at the newest fix);
 * - a deviation beyond the tolerance survives (a corner is a corner);
 * - jitter inside the tolerance is dropped (the noise a stationary bus
 *   produces while parked at a stop);
 * - the output is order-preserving and a subset — never moved, never invented;
 * - the tolerance is in METRES, so the result cannot depend on latitude.
 */

/** Metres of latitude per 0.00001° — a fine-grained vertical step. */
const M = 111_320;

describe('simplifyPolylineMeters', () => {
  it('keeps both endpoints and everything beyond the tolerance', () => {
    const line: Array<[number, number]> = [
      [72.8777, 19.076],
      [72.8777, 19.076 + 2 / M], // ~1.2 m off the p1→p3 chord — sub-tolerance wiggle
      [72.88, 19.079],
      [72.883, 19.082],
    ];
    const simplified = simplifyPolylineMeters(line, TRAIL_SIMPLIFY_TOLERANCE_METERS);
    // The three anchor points span hundreds of metres; the one sub-tolerance
    // wiggle is the only point removed.
    assert.deepEqual(simplified, [
      [72.8777, 19.076],
      [72.88, 19.079],
      [72.883, 19.082],
    ]);
  });

  it('drops jitter inside the tolerance (a bus parked at a stop)', () => {
    const parked: Array<[number, number]> = [
      [72.8777, 19.076],
      [72.8777, 19.076 + 1 / M], // 1 m
      [72.8777, 19.076 - 1 / M], // 1 m the other way
      [72.8777, 19.076 + 2 / M], // 2 m
      [72.8777, 19.076 + 1 / M], // 1 m
    ];
    // All the wiggle is within 5 m of the endpoints' chord, so only the
    // endpoints survive.
    assert.deepEqual(simplifyPolylineMeters(parked, 5), [
      [72.8777, 19.076],
      [72.8777, 19.076 + 1 / M],
    ]);
  });

  it('keeps a corner whose apex is beyond the tolerance', () => {
    // A hairpin: out 100 m east, back 100 m west. The apex is 100 m from the
    // chord between the endpoints, so it can never be dropped.
    const hairpin: Array<[number, number]> = [
      [72.8, 19.0],
      [72.8 + 100 / (111_320 * Math.cos((19.0 * Math.PI) / 180)), 19.0],
      [72.8, 19.0],
    ];
    const simplified = simplifyPolylineMeters(hairpin, 5);
    assert.equal(simplified.length, 3);
    assert.deepEqual(simplified, hairpin);
  });

  it('keeps a point just inside a tighter tolerance and drops it in a looser one', () => {
    // A point ~8 m off the chord (longitude metres at the equator): kept at
    // the 5 m trail tolerance, dropped at 10 m.
    const line: Array<[number, number]> = [
      [0, 0],
      [8 / 111_413, 0.00008],
      [0, 0.001],
    ];
    assert.equal(simplifyPolylineMeters(line, 5).length, 3);
    assert.equal(simplifyPolylineMeters(line, 10).length, 2);
  });

  it('is latitude-independent: the same shape decimates the same way far north', () => {
    // The same perpendicular offset expressed in degrees of LONGITUDE is worth
    // ~2.2x more metres at 19° than at 65° — the metre tolerance must
    // compensate, where a degree tolerance would not.
    const offsetDeg = 0.0001;
    const build = (latitude: number): Array<[number, number]> => [
      [20.0, latitude],
      [20.0 + offsetDeg, latitude],
      [20.0, latitude + 0.001],
    ];
    // ~10.5 m of longitude offset at 19°: beyond 5 m, kept.
    assert.equal(simplifyPolylineMeters(build(19), 5).length, 3);
    // The same degree offset at 65° is ~4.7 m: inside 5 m, dropped.
    assert.equal(simplifyPolylineMeters(build(65), 5).length, 2);
  });

  it('never reorders, moves or invents points', () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [0.001, 0.004],
      [0.002, 0.001],
      [0.003, 0.005],
      [0.004, 0.004],
      [0.005, 0],
    ];
    const simplified = simplifyPolylineMeters(line, 5);
    for (const point of simplified) {
      assert.ok(line.some((candidate) => candidate === point));
    }
    // Still a subsequence: indices are strictly increasing.
    let previous = -1;
    for (const point of simplified) {
      const index = line.findIndex((candidate) => candidate === point);
      assert.ok(index > previous);
      previous = index;
    }
    assert.deepEqual(simplified[0], line[0]);
    assert.deepEqual(simplified[simplified.length - 1], line[line.length - 1]);
  });

  it('returns short or undecimatable lines unchanged (as a copy)', () => {
    const two: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    assert.deepEqual(simplifyPolylineMeters(two, 5), two);
    assert.notEqual(simplifyPolylineMeters(two, 5), two);
    const zero = simplifyPolylineMeters([], 5);
    assert.deepEqual(zero, []);
    // A non-positive tolerance disables decimation rather than corrupting.
    const line: Array<[number, number]> = [
      [0, 0],
      [0.0001, 0.0001],
      [0, 0.001],
    ];
    assert.deepEqual(simplifyPolylineMeters(line, 0), line);
  });
});

describe('decimateTrailLine', () => {
  it('returns a new feature with the same properties and fewer coordinates', () => {
    const feature = {
      type: 'Feature' as const,
      properties: { trip: 't1' },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [72.8777, 19.076],
          [72.8777, 19.076 + 1 / M],
          [72.88, 19.079],
        ] as Array<[number, number]>,
      },
    };
    const decimated = decimateTrailLine(feature);
    assert.equal(decimated.type, 'Feature');
    assert.deepEqual(decimated.properties, { trip: 't1' });
    assert.deepEqual(decimated.geometry.coordinates, [
      [72.8777, 19.076],
      [72.88, 19.079],
    ]);
    // The input is untouched.
    assert.equal(feature.geometry.coordinates.length, 3);
  });
});
