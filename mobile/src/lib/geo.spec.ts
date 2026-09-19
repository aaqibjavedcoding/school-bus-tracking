import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  bearingDegrees,
  buildLocationPayload,
  fixAgeMs,
  gpsSignalTier,
  haversineMeters,
  normalizeDeviceHeading,
} from './geo.ts';

/**
 * GPS mapping guards: the crew app must forward device fixes exactly as the
 * API's `trip:location:update` Zod contract expects (km/h speed, normalized
 * heading, ISO timestamp) and drop anything malformed instead of repairing
 * it. Distances/bearings are pure math over WGS-84 degrees.
 */
describe('haversineMeters', () => {
  it('measures a known short distance', () => {
    // ~111 km per degree of latitude.
    const meters = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    assert.ok(Math.abs(meters - 111_195) < 200, `unexpected ${meters}`);
  });

  it('is zero for the same point and symmetric', () => {
    const a = { latitude: 51.5, longitude: -0.12 };
    const b = { latitude: 48.85, longitude: 2.35 };
    assert.equal(haversineMeters(a, a), 0);
    assert.ok(Math.abs(haversineMeters(a, b) - haversineMeters(b, a)) < 1e-9);
  });
});

describe('bearingDegrees', () => {
  it('points east for an eastward target and north for a northward one', () => {
    const east = bearingDegrees({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    assert.ok(Math.abs(east - 90) < 0.01, `east was ${east}`);
    const north = bearingDegrees({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    assert.ok(Math.abs(north - 0) < 0.01, `north was ${north}`);
  });

  it('always stays inside 0..360', () => {
    const west = bearingDegrees({ latitude: 0, longitude: 1 }, { latitude: 0, longitude: 0 });
    assert.ok(west > 180 && west <= 360, `west was ${west}`);
  });
});

describe('buildLocationPayload', () => {
  const fix = {
    coords: {
      latitude: 51.5007,
      longitude: -0.1246,
      accuracy: 12.5,
      speed: 8.2, // m/s
      heading: 270,
    },
    timestamp: Date.UTC(2026, 7, 29, 8, 30, 0),
  };

  it('maps an expo-location fix onto the API contract', () => {
    const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', fix);
    assert.ok(payload);
    assert.equal(payload!.latitude, 51.5007);
    assert.equal(payload!.longitude, -0.1246);
    assert.equal(payload!.accuracy, 12.5);
    assert.equal(payload!.speed, 8.2 * 3.6); // converted to km/h
    assert.equal(payload!.heading, 270);
    assert.equal(payload!.recorded_at, '2026-08-29T08:30:00.000Z');
  });

  /**
   * `expo-location` reports `-1` when the device has no course. Normalising
   * that into `[0, 360)` produced `359` — a stationary phone claiming due
   * north. These are the regression tests for that bug.
   */
  it('omits the unavailable heading sentinel instead of uploading 359', () => {
    const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      ...fix,
      coords: { ...fix.coords, heading: -1 },
    });
    assert.ok(payload);
    assert.equal('heading' in payload!, false, 'heading: -1 must not become 359');
    assert.equal(payload!.heading, undefined);
  });

  it('omits every negative heading, not just exactly -1', () => {
    for (const heading of [-0.5, -90, -180, -359.9]) {
      const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
        ...fix,
        coords: { ...fix.coords, heading },
      });
      assert.ok(payload);
      assert.equal('heading' in payload!, false, `heading ${heading} must be omitted`);
    }
  });

  it('omits a non-finite heading rather than clamping it', () => {
    for (const heading of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
        ...fix,
        coords: { ...fix.coords, heading },
      });
      assert.ok(payload);
      assert.equal('heading' in payload!, false, `heading ${heading} must be omitted`);
    }
  });

  it('preserves a valid due-north heading of 0', () => {
    // 0 is a real direction (north), distinct from "no course". Only the
    // unavailable sentinels are dropped.
    const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      ...fix,
      coords: { ...fix.coords, heading: 0 },
    });
    assert.ok(payload);
    assert.equal(payload!.heading, 0);
  });

  it('keeps a valid heading and still wraps one above 360', () => {
    const kept = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      ...fix,
      coords: { ...fix.coords, heading: 359.5 },
    });
    assert.ok(kept);
    assert.ok(Math.abs(kept!.heading! - 359.5) < 1e-9);

    const wrapped = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      ...fix,
      coords: { ...fix.coords, heading: 450 },
    });
    assert.ok(wrapped);
    assert.ok(Math.abs(wrapped!.heading! - 90) < 1e-9);
  });

  it('omits readings the device could not provide instead of zero-filling', () => {
    const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      coords: { latitude: 10, longitude: 10, speed: -1, accuracy: null, heading: null },
      timestamp: Date.UTC(2026, 0, 1),
    });
    assert.ok(payload);
    assert.equal('speed' in payload!, false);
    assert.equal('accuracy' in payload!, false);
    assert.equal('heading' in payload!, false);
  });

  it('drops an out-of-range fix (schema violation) rather than clamping it', () => {
    const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      coords: { latitude: 200, longitude: 10 },
      timestamp: Date.UTC(2026, 0, 1),
    });
    assert.equal(payload, null);
  });

  it('drops a fix without a usable timestamp', () => {
    const payload = buildLocationPayload('11111111-1111-4111-8111-111111111111', {
      coords: { latitude: 10, longitude: 10 },
      timestamp: Number.NaN,
    });
    assert.equal(payload, null);
  });
});

describe('normalizeDeviceHeading', () => {
  it('treats every negative value as "no course"', () => {
    assert.equal(normalizeDeviceHeading(-1), null);
    assert.equal(normalizeDeviceHeading(-0.0001), null);
    assert.equal(normalizeDeviceHeading(-360), null);
  });

  it('treats missing and non-finite values as "no course"', () => {
    assert.equal(normalizeDeviceHeading(null), null);
    assert.equal(normalizeDeviceHeading(undefined), null);
    assert.equal(normalizeDeviceHeading(Number.NaN), null);
    assert.equal(normalizeDeviceHeading(Number.POSITIVE_INFINITY), null);
  });

  it('keeps real directions, including due north and the 360 wrap', () => {
    assert.equal(normalizeDeviceHeading(0), 0);
    assert.equal(normalizeDeviceHeading(90), 90);
    assert.equal(normalizeDeviceHeading(359.9), 359.9);
    assert.equal(normalizeDeviceHeading(360), 0);
    assert.equal(normalizeDeviceHeading(450), 90);
  });
});

describe('fixAgeMs and gpsSignalTier', () => {
  const now = Date.UTC(2026, 7, 29, 9, 0, 0);

  it('computes the age of a fix', () => {
    assert.equal(fixAgeMs('2026-08-29T08:59:45.000Z', now), 15_000);
    assert.equal(fixAgeMs('not-a-date', now), null);
  });

  it('tiers GPS quality from age and accuracy', () => {
    assert.equal(gpsSignalTier(10_000, 8), 'good');
    assert.equal(gpsSignalTier(10_000, 80), 'weak');
    assert.equal(gpsSignalTier(20_000, 8), 'weak');
    assert.equal(gpsSignalTier(60_000, 8), 'stale');
    assert.equal(gpsSignalTier(null, null), 'stale');
  });
});
