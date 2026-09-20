import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { haversineMeters } from '../../lib/geo.ts';
import { accuracyCirclePolygon, destinationPoint, type CircleCenter } from './accuracy-circle.ts';

/**
 * The accuracy-ring geometry, pinned. The ring is presentation only (the
 * measurement's uncertainty, drawn rather than asserted), so what the spec
 * guards is that it is *true*: every vertex actually sits on the reported
 * radius, and the polygon is valid GeoJSON a map renderer will accept.
 */

const CENTER: CircleCenter = { latitude: 19.076, longitude: 72.8777 };
const RADIUS = 120; // metres — a plausible coarse urban fix

describe('destinationPoint', () => {
  it('zero distance lands on the origin', () => {
    const point = destinationPoint(CENTER, 45, 0);
    assert.ok(haversineMeters(CENTER, point) < 1e-6);
  });

  it('north increases latitude and keeps the longitude', () => {
    const point = destinationPoint(CENTER, 0, RADIUS);
    assert.ok(point.latitude > CENTER.latitude);
    assert.ok(Math.abs(point.longitude - CENTER.longitude) < 1e-6);
    assert.ok(Math.abs(haversineMeters(CENTER, point) - RADIUS) < 0.01 * RADIUS);
  });

  it('east increases longitude and (nearly) keeps the latitude', () => {
    const point = destinationPoint(CENTER, 90, RADIUS);
    assert.ok(point.longitude > CENTER.longitude);
    assert.ok(Math.abs(point.latitude - CENTER.latitude) < 0.0005);
    assert.ok(Math.abs(haversineMeters(CENTER, point) - RADIUS) < 0.01 * RADIUS);
  });

  it('south and west go the other way', () => {
    const south = destinationPoint(CENTER, 180, RADIUS);
    const west = destinationPoint(CENTER, 270, RADIUS);
    assert.ok(south.latitude < CENTER.latitude);
    assert.ok(west.longitude < CENTER.longitude);
  });

  it('wraps the longitude across the antimeridian instead of producing 190°', () => {
    const nearDateLine: CircleCenter = { latitude: 0, longitude: 179.99 };
    const east = destinationPoint(nearDateLine, 90, 100_000);
    assert.ok(east.longitude > -180 && east.longitude < 180);
    assert.ok(east.longitude < 0, 'crossing east of 179.99° must land west of the antimeridian');
  });
});

describe('accuracyCirclePolygon', () => {
  const feature = accuracyCirclePolygon(CENTER, RADIUS);

  it('is a GeoJSON feature with one closed ring', () => {
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Polygon');
    const ring = feature.geometry.coordinates[0];
    assert.ok(ring.length >= 4, 'a ring needs at least four points');
    const [first, last] = [ring[0], ring[ring.length - 1]];
    assert.deepEqual(first, last, 'the ring must be explicitly closed');
  });

  it('uses the default 64 vertices (65 counting the closure)', () => {
    assert.equal(feature.geometry.coordinates[0].length, 65);
  });

  it('honours a custom vertex count (floored at 3, so the ring never degenerates)', () => {
    assert.equal(accuracyCirclePolygon(CENTER, RADIUS, 8).geometry.coordinates[0].length, 9);
    assert.equal(accuracyCirclePolygon(CENTER, RADIUS, 2).geometry.coordinates[0].length, 4);
  });

  it('keeps every vertex on the reported radius (within 1 % — spherical approximation)', () => {
    const ring = feature.geometry.coordinates[0];
    let worst = 0;
    for (const [lng, lat] of ring) {
      const distance = haversineMeters(CENTER, { latitude: lat, longitude: lng });
      worst = Math.max(worst, Math.abs(distance - RADIUS));
    }
    assert.ok(
      worst < 0.01 * RADIUS,
      `worst vertex error ${worst} m must stay under 1 % of ${RADIUS} m`,
    );
  });

  it('spans roughly the right bounding box', () => {
    const ring = feature.geometry.coordinates[0];
    const lats = ring.map(([, lat]) => lat);
    const lngs = ring.map(([lng]) => lng);
    const latSpanM = haversineMeters(
      { latitude: Math.min(...lats), longitude: CENTER.longitude },
      { latitude: Math.max(...lats), longitude: CENTER.longitude },
    );
    assert.ok(latSpanM > 2 * RADIUS * 0.98 && latSpanM < 2 * RADIUS * 1.02);
    assert.ok(
      lngs.every((lng) => lng > CENTER.longitude - 0.005 && lng < CENTER.longitude + 0.005),
    );
  });

  it('is deterministic (same input, same ring — the style engine diffs it)', () => {
    assert.deepEqual(accuracyCirclePolygon(CENTER, RADIUS), accuracyCirclePolygon(CENTER, RADIUS));
  });

  it('does not leak into the measurement: the feature is geometry only', () => {
    assert.deepEqual(feature.properties, {}, 'no properties to misread as data');
  });
});
