import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { hashRouteStops, renderCoordinate, STOPS_HASH_LENGTH } from './stops-hash';

/**
 * `stops_hash` is the forever-cache key: get it wrong in either direction
 * and the feature breaks expensively. Too twitchy (hashing raw floats) and
 * sub-millimetre GPS jitter defeats the cache, turning "20 engine calls per
 * lifetime" into a per-read bill. Too lax (normalizing order, dropping a
 * coordinate) and a school is served a polyline that no longer visits its
 * stops. These cases pin the middle course and the exact serialization, so
 * a "harmless refactor" cannot silently invalidate every cached row.
 */

const STOP_A = { stopId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', latitude: 33.6844, longitude: 73.0479 };
const STOP_B = { stopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', latitude: 33.6901, longitude: 73.0551 };
const STOP_C = { stopId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', latitude: 33.6972, longitude: 73.0613 };

describe('hashRouteStops', () => {
  it('is a 64-character sha256 hex digest', () => {
    const hash = hashRouteStops([STOP_A, STOP_B]);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash.length, STOPS_HASH_LENGTH);
  });

  it('is deterministic: same input, same hash, process after process', () => {
    assert.equal(hashRouteStops([STOP_A, STOP_B, STOP_C]), hashRouteStops([STOP_A, STOP_B, STOP_C]));
  });

  it('pins the exact serialization — verifiable with plain sha256', () => {
    // One tuple per line: `stopId,lat,lng`, coordinates at 6 decimals.
    const canonical = [
      `${STOP_A.stopId},33.684400,73.047900`,
      `${STOP_B.stopId},33.690100,73.055100`,
    ].join('\n');
    const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');
    assert.equal(hashRouteStops([STOP_A, STOP_B]), expected);
  });

  it('changes when the stop ORDER changes — order is the route', () => {
    assert.notEqual(hashRouteStops([STOP_A, STOP_B, STOP_C]), hashRouteStops([STOP_C, STOP_B, STOP_A]));
    assert.notEqual(hashRouteStops([STOP_A, STOP_B]), hashRouteStops([STOP_B, STOP_A]));
  });

  it('changes when membership changes, even with identical coordinates', () => {
    assert.notEqual(hashRouteStops([STOP_A, STOP_B]), hashRouteStops([STOP_A, STOP_B, STOP_C]));
    assert.notEqual(hashRouteStops([STOP_A, STOP_B]), hashRouteStops([STOP_A]));
    const renamedB = { ...STOP_B, stopId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    assert.notEqual(hashRouteStops([STOP_A, STOP_B]), hashRouteStops([STOP_A, renamedB]));
  });

  it('ignores jitter below the 6th decimal (phone GPS is never that precise)', () => {
    const jitteredA = { ...STOP_A, latitude: 33.68440001, longitude: 73.04789999 };
    assert.equal(hashRouteStops([STOP_A, STOP_B]), hashRouteStops([jitteredA, STOP_B]));
  });

  it('changes when a stop genuinely moves (6th decimal)', () => {
    const movedA = { ...STOP_A, latitude: 33.6845 };
    assert.notEqual(hashRouteStops([STOP_A, STOP_B]), hashRouteStops([movedA, STOP_B]));
  });

  it('hashes the empty list to the sha256 of the empty string — defined, never thrown', () => {
    assert.equal(
      hashRouteStops([]),
      createHash('sha256').update('', 'utf8').digest('hex'),
    );
  });
});

describe('renderCoordinate', () => {
  it('renders exactly 6 decimals, rounding the 7th decimal away', () => {
    assert.equal(renderCoordinate(33.6844), '33.684400');
    assert.equal(renderCoordinate(73.04795), '73.047950');
    assert.equal(renderCoordinate(0.1234564), '0.123456');
    assert.equal(renderCoordinate(33.1234567), '33.123457'); // 7th decimal rounds the 6th up
    assert.equal(renderCoordinate(-73.0479), '-73.047900');
    assert.equal(renderCoordinate(180), '180.000000');
  });

  it('normalizes negative zero — the same point must not hash twice', () => {
    assert.equal(renderCoordinate(-0.00000001), '0.000000');
    assert.equal(renderCoordinate(0.00000001), '0.000000');
    assert.equal(renderCoordinate(0), '0.000000');
  });
});
