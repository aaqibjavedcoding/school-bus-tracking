import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FRAME_MIN_INTERVAL_MS,
  MOTION_THRESHOLDS,
  animationDurationMs,
  createBusMotion,
  easeInOutCubic,
  isValidCoordinate,
  jitterThresholdMeters,
  lerp,
  lerpAngle,
  normalizeHeading,
  resolveHeading,
  shortestAngleDelta,
  type BusMotionFix,
} from './bus-motion.ts';
import { bearingDegrees, haversineMeters } from '../../lib/geo.ts';

/**
 * Deterministic tests for the presentation-only motion state machine.
 *
 * No clock, no timer, no renderer: `push`/`sample` take `now` explicitly, so
 * every branch below is a plain function call. **All coordinates in this file
 * are synthetic test fixtures** (a straight road and one right-angle turn near
 * Pune) and exist only here — nothing in this module is reachable from the
 * tracking data path.
 */

const T0 = Date.parse('2026-09-19T07:00:00.000Z');
const iso = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

/** One metre of latitude, in degrees — enough to build fixtures by hand. */
const ONE_METER_LAT = 1 / 111_320;

function fixAt(
  metresNorth: number,
  recordedOffsetMs: number,
  extra: Partial<BusMotionFix> = {},
): BusMotionFix {
  return {
    latitude: 18.5 + metresNorth * ONE_METER_LAT,
    longitude: 73.85,
    heading: null,
    speed: 30,
    accuracy: 8,
    recorded_at: iso(recordedOffsetMs),
    ...extra,
  };
}

describe('coordinate validation', () => {
  it('accepts ordinary WGS-84 coordinates', () => {
    assert.equal(isValidCoordinate(18.5204, 73.8567), true);
    assert.equal(isValidCoordinate(-33.8688, 151.2093), true);
    assert.equal(isValidCoordinate(90, 180), true);
    assert.equal(isValidCoordinate(-90, -180), true);
  });

  it('rejects out-of-range coordinates', () => {
    assert.equal(isValidCoordinate(90.0001, 0), false);
    assert.equal(isValidCoordinate(-90.0001, 0), false);
    assert.equal(isValidCoordinate(0, 180.0001), false);
    assert.equal(isValidCoordinate(0, -180.0001), false);
  });

  it('rejects non-finite and non-numeric coordinates', () => {
    assert.equal(isValidCoordinate(Number.NaN, 73.85), false);
    assert.equal(isValidCoordinate(18.5, Number.POSITIVE_INFINITY), false);
    assert.equal(isValidCoordinate(18.5, Number.NEGATIVE_INFINITY), false);
    assert.equal(isValidCoordinate(undefined, 73.85), false);
    assert.equal(isValidCoordinate(null, null), false);
    assert.equal(isValidCoordinate('18.5', '73.85'), false);
  });

  it('rejects the (0, 0) null-island sentinel but keeps a real single zero axis', () => {
    assert.equal(isValidCoordinate(0, 0), false);
    assert.equal(isValidCoordinate(0, 73.85), true);
    assert.equal(isValidCoordinate(18.5, 0), true);
  });
});

describe('heading maths', () => {
  it('normalises any angle into [0, 360)', () => {
    assert.equal(normalizeHeading(0), 0);
    assert.equal(normalizeHeading(360), 0);
    assert.equal(normalizeHeading(720), 0);
    assert.equal(normalizeHeading(-1), 359);
    assert.equal(normalizeHeading(-360), 0);
    assert.equal(normalizeHeading(359.5), 359.5);
  });

  it('returns null rather than NaN for missing or invalid headings', () => {
    assert.equal(normalizeHeading(null), null);
    assert.equal(normalizeHeading(undefined), null);
    assert.equal(normalizeHeading(Number.NaN), null);
    assert.equal(normalizeHeading(Number.POSITIVE_INFINITY), null);
  });

  it('takes the shortest angular path, including 359° → 1°', () => {
    assert.equal(shortestAngleDelta(359, 1), 2);
    assert.equal(shortestAngleDelta(1, 359), -2);
    // Exactly 180° apart is a tie; the module breaks it deterministically.
    assert.equal(shortestAngleDelta(0, 180), -180);
    assert.equal(shortestAngleDelta(0, 181), -179);
    assert.equal(shortestAngleDelta(90, 90), 0);
    assert.equal(shortestAngleDelta(0, 90), 90);
    assert.equal(shortestAngleDelta(270, 90), -180);
  });

  it('interpolates along the short arc, never the long way round', () => {
    assert.equal(lerpAngle(359, 1, 0.5), 0);
    assert.equal(lerpAngle(350, 10, 0.5), 0);
    assert.equal(lerpAngle(10, 350, 0.5), 0);
    assert.equal(lerpAngle(0, 90, 0.25), 22.5);
    assert.equal(lerpAngle(0, 90, 0), 0);
    assert.equal(lerpAngle(0, 90, 1), 90);
  });

  it('clamps interpolation rather than extrapolating', () => {
    assert.equal(lerp(0, 10, -1), 0);
    assert.equal(lerp(0, 10, 2), 10);
    assert.equal(lerp(0, 10, 0.5), 5);
    assert.equal(easeInOutCubic(-0.5), 0);
    assert.equal(easeInOutCubic(1.5), 1);
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
  });

  it('derives a bearing that matches the geodesy helper', () => {
    const from = { latitude: 18.5, longitude: 73.85 };
    const north = { latitude: 18.5 + 100 * ONE_METER_LAT, longitude: 73.85 };
    assert.ok(Math.abs(bearingDegrees(from, north) - 0) < 0.5, 'due north ≈ 0°');
  });
});

describe('resolveHeading', () => {
  const from = { latitude: 18.5, longitude: 73.85 };
  const to = { latitude: 18.5 + 100 * ONE_METER_LAT, longitude: 73.85 };

  it('prefers a device heading when the bus is really moving', () => {
    assert.equal(resolveHeading({ heading: 123, speedKmh: 30, from, to, previous: 0 }), 123);
  });

  it('ignores a device heading at or below the minimum course speed', () => {
    // Falls through to the derived bearing, because the displacement is large.
    const derived = resolveHeading({ heading: 123, speedKmh: 1, from, to, previous: 0 });
    assert.ok(derived !== null && Math.abs(derived) < 1, `expected ≈0°, got ${derived}`);
  });

  it('holds the previous heading when stopped or barely displaced', () => {
    const tiny = { latitude: 18.5 + 1 * ONE_METER_LAT, longitude: 73.85 };
    assert.equal(
      resolveHeading({ heading: null, speedKmh: 0, from, to: tiny, previous: 214 }),
      214,
      'a parked bus must not spin',
    );
    assert.equal(
      resolveHeading({ heading: null, speedKmh: null, from, to: tiny, previous: 214 }),
      214,
    );
  });

  it('falls back to the derived bearing when the device reports no heading', () => {
    const derived = resolveHeading({ heading: null, speedKmh: null, from, to, previous: 42 });
    assert.ok(derived !== null && Math.abs(derived) < 1, `expected ≈0°, got ${derived}`);
  });

  it('normalises an out-of-range device heading instead of passing it through', () => {
    assert.equal(resolveHeading({ heading: 361, speedKmh: 40, from: null, to, previous: null }), 1);
    assert.equal(
      resolveHeading({ heading: -1, speedKmh: 40, from: null, to, previous: null }),
      359,
    );
  });

  it('returns null only when nothing has ever been established', () => {
    const tiny = { latitude: 18.5 + 1 * ONE_METER_LAT, longitude: 73.85 };
    assert.equal(
      resolveHeading({ heading: null, speedKmh: null, from, to: tiny, previous: null }),
      null,
    );
  });
});

describe('derived thresholds', () => {
  it('scales the jitter gate from accuracy, clamped at both ends', () => {
    assert.equal(jitterThresholdMeters(null), MOTION_THRESHOLDS.jitterMinM);
    assert.equal(jitterThresholdMeters(undefined), MOTION_THRESHOLDS.jitterMinM);
    assert.equal(jitterThresholdMeters(-5), MOTION_THRESHOLDS.jitterMinM);
    assert.equal(jitterThresholdMeters(0), MOTION_THRESHOLDS.jitterMinM);
    assert.equal(jitterThresholdMeters(8), 4);
    assert.equal(jitterThresholdMeters(20), 10);
    assert.equal(jitterThresholdMeters(1_000), MOTION_THRESHOLDS.jitterMaxM);
  });

  it('never clamps the jitter gate high enough to hide real movement', () => {
    assert.ok(MOTION_THRESHOLDS.jitterMaxM <= 30, 'a coarse fix must still move the bus');
  });

  it('derives animation length from cadence within documented bounds', () => {
    assert.equal(animationDurationMs(4_000), 3_000);
    assert.equal(animationDurationMs(3_000), 2_400);
    assert.equal(animationDurationMs(2_500), 2_000);
    assert.equal(animationDurationMs(null), MOTION_THRESHOLDS.animationMinMs);
    // A 500 ms cadence is bounded up to `cadenceMinMs` (1 s) first, so the
    // tween floor is 800 ms — `animationMinMs` only applies with no cadence.
    assert.equal(animationDurationMs(500), 800);
    assert.equal(animationDurationMs(1_000), 800);
    assert.equal(animationDurationMs(600_000), MOTION_THRESHOLDS.animationMaxMs);
  });

  it('keeps the animation inside the observed cadence so the bus cannot lag far behind', () => {
    for (const cadence of [2_500, 4_000, 6_000, 10_000]) {
      assert.ok(
        animationDurationMs(cadence) <= cadence,
        `duration ${animationDurationMs(cadence)} exceeds cadence ${cadence}`,
      );
    }
  });

  it('pins the shared frame cap', () => {
    assert.equal(FRAME_MIN_INTERVAL_MS, 50);
  });
});

describe('bus motion: first, duplicate and out-of-order fixes', () => {
  it('draws the first fix immediately, with no animation', () => {
    const motion = createBusMotion();
    const outcome = motion.push(fixAt(0, 0), T0);
    assert.deepEqual(outcome, { action: 'snapped', reason: 'first-fix', distanceMeters: 0 });
    const rendered = motion.sample(T0)!;
    assert.equal(rendered.latitude, 18.5);
    assert.equal(rendered.longitude, 73.85);
    assert.equal(rendered.moving, false);
  });

  it('rejects a duplicate fix on identical recorded_at', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    assert.deepEqual(motion.push(fixAt(50, 0), T0 + 100), {
      action: 'ignored',
      reason: 'duplicate-or-out-of-order',
    });
    assert.equal(motion.sample(T0 + 100)!.latitude, 18.5);
  });

  it('rejects an out-of-order fix that is older than the newest one', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(100, 8_000), T0 + 8_000);
    const outcome = motion.push(fixAt(50, 4_000), T0 + 9_000);
    assert.deepEqual(outcome, { action: 'ignored', reason: 'duplicate-or-out-of-order' });
  });

  it('accepts a fix whose recorded_at is newer even if it arrives out of order on the wire', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    // The REST snapshot resolves after a newer socket push; the *newer* fix wins.
    const outcome = motion.push(fixAt(200, 12_000), T0 + 12_500);
    assert.equal(outcome.action, 'animated');
  });

  it('ignores invalid coordinates and an unparseable timestamp without corrupting state', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    assert.deepEqual(motion.push({ ...fixAt(100, 4_000), latitude: Number.NaN }, T0 + 4_000), {
      action: 'ignored',
      reason: 'invalid-coordinate',
    });
    assert.deepEqual(motion.push({ ...fixAt(100, 4_000), recorded_at: 'not-a-date' }, T0 + 4_000), {
      action: 'ignored',
      reason: 'invalid-timestamp',
    });
    assert.equal(motion.sample(T0 + 4_000)!.latitude, 18.5);
  });

  it('never renders before the first valid fix', () => {
    const motion = createBusMotion();
    assert.equal(motion.sample(T0), null);
  });
});

describe('bus motion: jitter, noise and slow movement', () => {
  it('holds position for movement inside the accuracy-derived jitter gate', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0, { accuracy: 20 }), T0);
    // 6 m with 20 m accuracy → 10 m gate → held.
    const outcome = motion.push(fixAt(6, 4_000, { accuracy: 20 }), T0 + 4_000);
    assert.deepEqual(outcome.action, 'held');
    assert.equal(motion.sample(T0 + 4_000)!.latitude, 18.5);
  });

  it('does not let a held jitter fix spin the heading', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0, { accuracy: 20, heading: 90 }), T0);
    motion.push(fixAt(6, 4_000, { accuracy: 20, heading: 270 }), T0 + 4_000);
    assert.equal(motion.sample(T0 + 4_000)!.headingDeg, 90);
  });

  it('moves when noisy fixes accumulate past the gate, so creeping is not hidden', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0, { accuracy: 4 }), T0);
    let moved = false;
    for (let step = 1; step <= 5; step += 1) {
      const outcome = motion.push(
        fixAt(step * 3, step * 4_000, { accuracy: 4 }),
        T0 + step * 4_000,
      );
      if (outcome.action === 'animated') moved = true;
    }
    assert.ok(moved, 'a 3 m/fix creep past a 2 m gate must eventually move the bus');
  });

  it('keeps advancing the freshness clock while holding a jitter fix', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0, { accuracy: 20 }), T0);
    motion.push(fixAt(4, 4_000, { accuracy: 20 }), T0 + 4_000);
    assert.equal(motion.sample(T0 + 4_000)!.source.recordedAtMs, T0 + 4_000);
  });

  it('reports raw source values untouched, never the interpolated position', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(100, 4_000, { speed: 41, accuracy: 7 }), T0 + 4_000);
    const mid = motion.sample(T0 + 5_000)!;
    assert.equal(mid.source.speed, 41);
    assert.equal(mid.source.accuracy, 7);
    assert.equal(mid.source.latitude, 18.5 + 100 * ONE_METER_LAT);
    assert.notEqual(mid.latitude, mid.source.latitude, 'rendered position is interpolated');
  });
});

describe('bus motion: mid-animation updates', () => {
  it('continues from the currently rendered position when a new fix interrupts', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    const first = motion.push(fixAt(100, 4_000), T0 + 4_000);
    assert.equal(first.action, 'animated');

    const midPosition = motion.sample(T0 + 5_000)!.latitude;
    assert.ok(midPosition > 18.5, 'the tween is part-way along');

    // A new fix arrives mid-tween: the tween restarts from `midPosition`,
    // not from the original origin, so there is no visible jump backwards.
    motion.push(fixAt(200, 8_000), T0 + 6_000);
    const after = motion.sample(T0 + 6_000)!;
    assert.ok(
      Math.abs(after.latitude - midPosition) < 1e-9,
      'a fresh tween starts exactly where the marker was',
    );
  });

  it('never queues: one interrupted tween per fix, and it always ends on a real fix', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    for (let step = 1; step <= 6; step += 1) {
      motion.push(fixAt(step * 50, step * 4_000), T0 + step * 4_000);
      motion.sample(T0 + step * 4_000 + 1_000);
    }
    assert.equal(motion.isAnimating(), true);
    const settled = motion.sample(T0 + 6 * 4_000 + 60_000)!;
    assert.equal(settled.latitude, 18.5 + 300 * ONE_METER_LAT, 'ends on the newest real fix');
    assert.equal(settled.moving, false);
  });

  it('monotonic progress: the rendered position never moves backwards on a straight road', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(120, 4_000), T0 + 4_000);
    let previous = 18.5;
    for (let ms = 0; ms <= 3_200; ms += 50) {
      const current = motion.sample(T0 + 4_000 + ms)!.latitude;
      assert.ok(current >= previous - 1e-12, `moved backwards at +${ms} ms`);
      previous = current;
    }
  });

  it('rotates through the short way when the heading crosses north mid-tween', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0, { heading: 350, speed: 30 }), T0);
    motion.push(fixAt(200, 4_000, { heading: 10, speed: 30 }), T0 + 4_000);
    const headings: number[] = [];
    for (let ms = 0; ms <= 3_000; ms += 250) {
      headings.push(motion.sample(T0 + 4_000 + ms)!.headingDeg!);
    }
    for (const heading of headings) {
      // 350 → 10 must sweep up through 0/360, never down through 180.
      assert.ok(heading >= 349 || heading <= 11, `heading ${heading} took the long way round`);
    }
    assert.ok(Math.abs(headings.at(-1)! - 10) < 0.5);
  });
});

describe('bus motion: gaps, implausible jumps and cleanup', () => {
  it('snaps instead of animating after a long gap', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    const outcome = motion.push(fixAt(500, 90_000), T0 + 90_000);
    assert.deepEqual(outcome.action, 'snapped');
    assert.deepEqual((outcome as { reason: string }).reason, 'long-gap');
    assert.equal(motion.sample(T0 + 90_000)!.latitude, 18.5 + 500 * ONE_METER_LAT);
    assert.equal(motion.isAnimating(), false);
  });

  it('snaps instead of racing across the city on an implausible jump', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    // 20 km in 4 s ≈ 5000 m/s. That is a coarse network fix, not a bus.
    const outcome = motion.push(fixAt(20_000, 4_000), T0 + 4_000);
    assert.deepEqual(outcome.action, 'snapped');
    assert.deepEqual((outcome as { reason: string }).reason, 'implausible-jump');
  });

  it('animates a plausible fast jump rather than treating it as bad data', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    // 100 m in 4 s = 25 m/s ≈ 90 km/h: fast, but inside the ceiling.
    assert.equal(motion.push(fixAt(100, 4_000), T0 + 4_000).action, 'animated');
  });

  it('halt() freezes the last known position and stops travel animation', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(60, 4_000), T0 + 4_000);
    motion.sample(T0 + 4_500);
    assert.equal(motion.isAnimating(), true, 'precondition: a tween is running');
    motion.halt();
    const frozen = motion.sample(T0 + 5_000)!;
    const later = motion.sample(T0 + 30_000)!;
    assert.equal(frozen.latitude, later.latitude, 'a halted marker does not slide');
    assert.equal(frozen.moving, false);
    assert.equal(frozen.latitude, 18.5 + 60 * ONE_METER_LAT, 'frozen on the real fix');
  });

  it('a fix pushed while halted snaps instead of creating an unrunnable tween', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.halt();
    const outcome = motion.push(fixAt(60, 4_000), T0 + 4_000);
    assert.deepEqual(outcome.action, 'snapped');
    assert.deepEqual((outcome as { reason: string }).reason, 'halted');
    assert.equal(motion.isAnimating(), false, 'no tween that sample() would refuse to advance');
    assert.equal(motion.sample(T0 + 4_000)!.latitude, 18.5 + 60 * ONE_METER_LAT);
  });

  it('resume() lets fresh data animate again', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.halt();
    motion.resume();
    motion.push(fixAt(60, 4_000), T0 + 4_000);
    assert.equal(motion.push(fixAt(120, 8_000), T0 + 8_000).action, 'animated');
  });

  it('reset() on a trip switch drops position, heading, cadence and tween', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(200, 4_000), T0 + 4_000);
    motion.reset();
    assert.equal(motion.sample(T0 + 5_000), null, 'no leftover position from the old trip');
    assert.equal(motion.cadence(), null);
    // The new trip's first fix is a first fix again — snapped, not animated
    // from a stale origin hundreds of metres away.
    assert.deepEqual(motion.push(fixAt(5_000, 8_000), T0 + 8_000), {
      action: 'snapped',
      reason: 'first-fix',
      distanceMeters: 0,
    });
  });

  it('cancelAnimation() stops the tween but keeps the last known position', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(60, 4_000), T0 + 4_000);
    motion.sample(T0 + 4_500);
    motion.cancelAnimation();
    assert.equal(motion.isAnimating(), false);
    assert.equal(motion.sample(T0 + 4_600)!.latitude, 18.5 + 60 * ONE_METER_LAT);
  });

  it('a foreground resume reconciles with current data and replays nothing', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(200, 4_000), T0 + 4_000);
    // App backgrounded: the loop stops, so no frames run for 10 minutes.
    motion.cancelAnimation();
    motion.push(fixAt(9_000, 600_000), T0 + 600_000);
    const resumed = motion.sample(T0 + 600_001)!;
    assert.equal(resumed.latitude, 18.5 + 9_000 * ONE_METER_LAT, 'snapped to now, not replayed');
    assert.equal(resumed.moving, false);
  });
});

describe('bus motion: reduced motion', () => {
  it('snaps every fix when reduced motion is on', () => {
    const motion = createBusMotion({ reducedMotion: true });
    motion.push(fixAt(0, 0), T0);
    const outcome = motion.push(fixAt(100, 4_000), T0 + 4_000);
    assert.deepEqual(outcome.action, 'snapped');
    assert.deepEqual((outcome as { reason: string }).reason, 'reduced-motion');
    assert.equal(motion.sample(T0 + 4_000)!.latitude, 18.5 + 100 * ONE_METER_LAT);
    assert.equal(motion.sample(T0 + 4_000)!.moving, false);
  });

  it('applies a mid-session preference change and stops a running tween', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(60, 4_000), T0 + 4_000);
    motion.sample(T0 + 4_200);
    assert.equal(motion.isAnimating(), true, 'precondition: a tween is running');
    motion.setReducedMotion(true);
    assert.equal(motion.isAnimating(), false, 'the running tween is cancelled, not played out');
    assert.equal(motion.sample(T0 + 4_300)!.latitude, 18.5 + 60 * ONE_METER_LAT);
  });

  it('restores animation when reduced motion is switched back off', () => {
    const motion = createBusMotion({ reducedMotion: true });
    motion.push(fixAt(0, 0), T0);
    motion.setReducedMotion(false);
    motion.push(fixAt(100, 4_000), T0 + 4_000);
    assert.equal(motion.push(fixAt(200, 8_000), T0 + 8_000).action, 'animated');
  });
});

describe('bus motion: heading over a turn', () => {
  it('follows the road direction through a right-angle turn', () => {
    const motion = createBusMotion();
    const east = { latitude: 18.5, longitude: 73.85 };
    motion.push({ ...east, heading: null, speed: null, accuracy: 6, recorded_at: iso(0) }, T0);
    // 120 m due north, then 120 m due east.
    motion.push(
      {
        latitude: 18.5 + 120 * ONE_METER_LAT,
        longitude: 73.85,
        heading: null,
        speed: null,
        accuracy: 6,
        recorded_at: iso(4_000),
      },
      T0 + 4_000,
    );
    // Sample after the tween has finished: heading interpolates over the same
    // tween as the position, so at t = 0 it is still the previous heading.
    const northLeg = motion.sample(T0 + 7_000)!.headingDeg!;
    assert.ok(Math.abs(northLeg) < 1, `north leg ≈ 0°, got ${northLeg}`);

    motion.push(
      {
        latitude: 18.5 + 120 * ONE_METER_LAT,
        longitude: 73.85 + (120 * ONE_METER_LAT) / Math.cos((18.5 * Math.PI) / 180),
        heading: null,
        speed: null,
        accuracy: 6,
        recorded_at: iso(8_000),
      },
      T0 + 8_000,
    );
    const eastLeg = motion.sample(T0 + 11_000)!.headingDeg!;
    assert.ok(Math.abs(eastLeg - 90) < 2, `east leg ≈ 90°, got ${eastLeg}`);
  });

  it('keeps a stable heading across a straight road with noisy positions', () => {
    const motion = createBusMotion();
    const headings: number[] = [];
    // Wobble ±4 m perpendicular to a northbound run, one fix every 4 s.
    for (let step = 0; step < 6; step += 1) {
      const wobble = step % 2 === 0 ? 0 : 4;
      motion.push(
        {
          latitude: 18.5 + step * 60 * ONE_METER_LAT,
          longitude: 73.85 + wobble * ONE_METER_LAT,
          heading: null,
          speed: null,
          accuracy: 6,
          recorded_at: iso(step * 4_000),
        },
        T0 + step * 4_000,
      );
      const heading = motion.sample(T0 + step * 4_000 + 3_900)!.headingDeg;
      if (heading !== null) headings.push(heading);
    }
    assert.ok(headings.length >= 3);
    for (const heading of headings) {
      // 356 deg is 4 deg *west* of north, so compare the unsigned deviation.
      const deviation = Math.min(heading, 360 - heading);
      assert.ok(deviation < 8, `noisy straight road produced heading ${heading}`);
    }
  });

  it('uses the reported device heading even when it disagrees with the bearing', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0, { heading: 45, speed: 30 }), T0);
    motion.push(fixAt(120, 4_000, { heading: 45, speed: 30 }), T0 + 4_000);
    assert.equal(motion.sample(T0 + 4_000)!.headingDeg, 45);
  });
});

describe('bus motion: cadence estimation', () => {
  it('learns the update cadence and bounds the estimate', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(60, 4_000), T0 + 4_000);
    assert.ok(Math.abs(motion.cadence()! - 4_000) < 1, `expected ≈4000, got ${motion.cadence()}`);
    motion.push(fixAt(120, 8_000), T0 + 8_000);
    assert.ok(Math.abs(motion.cadence()! - 4_000) < 1);
  });

  it('clamps one absurd gap so it cannot distort the tween length', () => {
    const motion = createBusMotion();
    motion.push(fixAt(0, 0), T0);
    motion.push(fixAt(60, 4_000), T0 + 4_000);
    // 44 s gap: below the snap threshold, above the cadence ceiling.
    motion.push(fixAt(400, 48_000), T0 + 48_000);
    assert.ok(
      motion.cadence()! <= MOTION_THRESHOLDS.cadenceMaxMs,
      `cadence ${motion.cadence()} exceeds the ceiling`,
    );
  });
});

describe('geodesy mirror', () => {
  it('agrees with the shared helper on the fixtures this spec uses', () => {
    const a = { latitude: 18.5, longitude: 73.85 };
    const b = { latitude: 18.5 + 100 * ONE_METER_LAT, longitude: 73.85 };
    const distance = haversineMeters(a, b);
    assert.ok(Math.abs(distance - 100) < 1, `expected ≈100 m, got ${distance}`);
  });
});

describe('shared thresholds are pinned identically on both platforms', () => {
  /**
   * `bus-motion.ts` is mirrored between `mobile/` and `web/` (the repository's
   * established pattern for client libraries). This test pins the exact numbers
   * in both workspaces, so editing one copy without the other fails a suite
   * rather than shipping two buses that move differently.
   */
  it('pins every motion threshold', () => {
    assert.deepEqual(
      { ...MOTION_THRESHOLDS },
      {
        headingMinSpeedKmh: 3,
        headingMinDisplacementM: 12,
        jitterMinM: 2,
        jitterMaxM: 30,
        jitterAccuracyFactor: 0.5,
        animationCadenceFactor: 0.8,
        animationMinMs: 500,
        animationMaxMs: 3_000,
        gapSnapMs: 45_000,
        maxPlausibleSpeedMps: 33,
        cadenceMinMs: 1_000,
        cadenceMaxMs: 30_000,
        cadenceSmoothing: 0.4,
      },
    );
  });

  it('keeps the snap gap far above the real GPS cadence', () => {
    // Device watch is 4000 ms and the server throttle floor is 2500 ms, so a
    // genuine cadence can never trip the snap threshold.
    assert.ok(MOTION_THRESHOLDS.gapSnapMs > 10 * 4_000);
  });

  it('keeps the plausibility ceiling above any real school-bus speed', () => {
    // 33 m/s ≈ 120 km/h.
    assert.ok(MOTION_THRESHOLDS.maxPlausibleSpeedMps * 3.6 > 100);
    assert.ok(MOTION_THRESHOLDS.maxPlausibleSpeedMps * 3.6 < 150);
  });
});
