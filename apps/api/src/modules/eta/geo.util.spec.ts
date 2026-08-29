import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  cumulativeStopDistancesMeters,
  effectiveSpeedKmh,
  etaMinutesForDistance,
  haversineMeters,
  sanitizeSpeedKmh,
} from './geo.util';
import { DEFAULT_ETA_CONFIG } from './eta.test-utils';

const closeTo = (actual: number, expected: number, tolerance = 1): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    assert.equal(haversineMeters(40.7, -74.0, 40.7, -74.0), 0);
  });

  it('returns the known meridian distance for one degree of latitude', () => {
    // 1° of latitude on the WGS-84 mean sphere ≈ 111,195 m.
    closeTo(haversineMeters(0, 0, 1, 0) ?? -1, 111_195, 10);
  });

  it('returns the known London → Paris great-circle distance', () => {
    const londonToParis = haversineMeters(51.5074, -0.1278, 48.8566, 2.3522);
    assert.ok(londonToParis !== null);
    closeTo(londonToParis, 343_556, 200);
  });

  it('is symmetric', () => {
    const a = haversineMeters(40.7, -74.0, 40.71, -73.99);
    const b = haversineMeters(40.71, -73.99, 40.7, -74.0);
    assert.ok(a !== null && b !== null);
    closeTo(a, b, 1e-6);
  });

  it('returns null when any coordinate is missing or non-finite', () => {
    assert.equal(haversineMeters(null, -74.0, 40.7, -74.0), null);
    assert.equal(haversineMeters(40.7, undefined, 40.7, -74.0), null);
    assert.equal(haversineMeters(40.7, -74.0, 40.7, NaN), null);
    assert.equal(haversineMeters(40.7, -74.0, 40.7, Infinity), null);
  });
});

describe('effectiveSpeedKmh (zero/invalid speed fallback)', () => {
  it('uses the GPS speed when it is positive and finite', () => {
    assert.equal(effectiveSpeedKmh(30, DEFAULT_ETA_CONFIG), 30);
  });

  it('falls back when the speed is null, undefined, zero, negative or NaN', () => {
    for (const unusable of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        effectiveSpeedKmh(unusable as number | null | undefined, DEFAULT_ETA_CONFIG),
        DEFAULT_ETA_CONFIG.fallbackSpeedKmh,
        `unusable speed: ${String(unusable)}`,
      );
    }
  });

  it('clamps absurd device speeds into the operational band', () => {
    assert.equal(effectiveSpeedKmh(500, DEFAULT_ETA_CONFIG), 90);
    assert.equal(effectiveSpeedKmh(0.2, DEFAULT_ETA_CONFIG), 5);
  });
});

describe('sanitizeSpeedKmh', () => {
  it('keeps only finite positive numbers', () => {
    assert.equal(sanitizeSpeedKmh(12.5), 12.5);
    assert.equal(sanitizeSpeedKmh(0), null);
    assert.equal(sanitizeSpeedKmh(null), null);
    assert.equal(sanitizeSpeedKmh(Number.NaN), null);
  });
});

describe('etaMinutesForDistance', () => {
  it('is zero at the stop or at zero speed', () => {
    assert.equal(etaMinutesForDistance(0, 25), 0);
    assert.equal(etaMinutesForDistance(500, 0), 0);
    assert.equal(etaMinutesForDistance(-1, 25), 0);
  });

  it('rounds up to whole minutes', () => {
    // 25 km/h = 416.67 m/min.
    assert.equal(etaMinutesForDistance(416, 25), 1);
    assert.equal(etaMinutesForDistance(417, 25), 2);
    assert.equal(etaMinutesForDistance(833, 25), 2);
    assert.equal(etaMinutesForDistance(834, 25), 3);
  });
});

describe('cumulativeStopDistancesMeters', () => {
  const start = { latitude: 40.7, longitude: -74.0 };
  const stops = [
    { latitude: 40.7, longitude: -73.99 }, // ~840 m from start
    { latitude: 40.7, longitude: -73.98 }, // ~840 m further
    { latitude: null, longitude: null },
    { latitude: 40.7, longitude: -73.97 }, // continues from the last known point
  ];

  it('accumulates the polyline distance through the stops', () => {
    const distances = cumulativeStopDistancesMeters(start, stops);
    assert.ok(distances[0] !== null && distances[1] !== null && distances[3] !== null);
    assert.equal(distances[2], null);
    closeTo(distances[0], 842, 5);
    closeTo(distances[1], 1684, 10);
    assert.ok(distances[1] > distances[0]);
    // The stop without coordinates is skipped; the path resumes from stop 2.
    closeTo(distances[3], 2526, 15);
  });
});
