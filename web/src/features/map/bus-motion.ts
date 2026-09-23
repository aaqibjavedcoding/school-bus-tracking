import { bearingDegrees, haversineMeters } from './geo.ts';

/**
 * Presentation-only bus motion: smooth interpolation, honest heading, jitter.
 *
 * ### What this module is
 *
 * A **pure, platform-free state machine** that turns a sparse stream of
 * received GPS fixes (the crew device watches at `WATCH_INTERVAL_MS = 4000`,
 * and the server throttle floor is `gpsMinIntervalMs = 2500`, so the observed
 * cadence is normally 2.5–4 s) into a stream of *rendered* positions the map
 * can draw at frame rate. It is deliberately written so that:
 *
 * - it takes `now` as an argument everywhere (no `Date.now()` inside), so every
 *   branch is testable with a deterministic clock under `node --test`;
 * - it imports no React, no React Native, no Leaflet — the same module runs on
 *   the web map and, mirrored at `mobile/src/features/map/bus-motion.ts`, on
 *   the native map. The only difference between the two copies is the geodesy
 *   import; `bus-motion.spec.ts` pins the same values on both sides.
 *
 * ### What this module is NOT
 *
 * **It never produces tracking data.** Its output is a pixel-position input for
 * a marker. Interpolated coordinates must never be written into history, ETA,
 * attendance, notifications or any payload — those keep consuming the raw fix.
 * It also:
 *
 * - never invents a fix (no dead reckoning, no "the bus is probably still
 *   going this way" extrapolation past the last received fix — the animation
 *   always *ends at* a real fix);
 * - is **not road matching**. Two sparse GPS points are joined by a straight
 *   line, so on a bend the bus visibly cuts the corner. That is a property of
 *   the data, not a bug in this module; `docs/live-tracking-map.md` says so.
 */

// ── Thresholds (centralised, documented) ───────────────────────────────────

export const MOTION_THRESHOLDS = {
  /**
   * Below this speed a device-reported course is noise: GPS course is derived
   * from Doppler/position deltas, and at walking pace those deltas are inside
   * the accuracy circle. Above it the device course is the most honest heading
   * we have, so it wins over a derived bearing.
   */
  headingMinSpeedKmh: 3,

  /**
   * Minimum separation (metres) between two accepted fixes before a *derived*
   * bearing may be used. Smaller than this, `atan2` over two points that are
   * both inside one accuracy circle produces a bearing that can swing 180°
   * between fixes — which reads as the bus spinning on the spot.
   */
  headingMinDisplacementM: 12,

  /** Jitter gate floor/ceiling, and the accuracy-derived term between them. */
  jitterMinM: 2,
  jitterMaxM: 30,
  jitterAccuracyFactor: 0.5,

  /**
   * Animation length is derived from the *observed* cadence, not hardcoded:
   * a 900 ms tween against a 4 s cadence (what the web map did before) makes
   * the bus lurch and then sit still. `0.8 × cadence` leaves ~20 % headroom so
   * a slightly late fix does not arrive mid-tween and cause a visible restart.
   */
  animationCadenceFactor: 0.8,
  /** Floor: below this a tween is shorter than a frame or two and just flickers. */
  animationMinMs: 500,
  /** Ceiling: bounds how far the bus can lag behind the newest real fix. */
  animationMaxMs: 3_000,

  /**
   * A gap longer than this between accepted fixes **snaps** instead of
   * animating. 45 s is >10× the nominal cadence: beyond that the tween would
   * show the bus racing across town to catch up, which is not what happened.
   */
  gapSnapMs: 45_000,

  /**
   * Implied-speed ceiling for a *visual* move, ~120 km/h. A KidBus run does
   * not exceed it, so a larger implied jump means the fix moved (tunnel exit,
   * urban-canyon multipath, a coarse network fix) rather than that the bus
   * travelled. Snap — never animate across the city.
   */
  maxPlausibleSpeedMps: 33,

  /** Bounds on the cadence estimate, so one anomalous gap cannot distort it. */
  cadenceMinMs: 1_000,
  cadenceMaxMs: 30_000,
  /** EWMA weight for a new sample (0.4 new / 0.6 history): damped, not twitchy. */
  cadenceSmoothing: 0.4,
} as const;

/**
 * Frame-rate cap for marker updates, shared by native and web.
 *
 * 50 ms ≈ 20 fps. A bus at 40 km/h covers ~0.55 m in 50 ms — sub-pixel at the
 * zoom levels a tracking card uses — so 20 fps is visually indistinguishable
 * from 60 here while costing a third of the native marker updates. Kept here
 * so both platforms use the same number and the spec can pin it.
 */
export const FRAME_MIN_INTERVAL_MS = 50;

// ── Geometry ───────────────────────────────────────────────────────────────

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Is this a coordinate we are willing to draw?
 *
 * Mirrors the bounds the API already enforces (`gpsLocationFixSchema`:
 * finite, −90..90, −180..180) and additionally rejects the exact `(0, 0)`
 * "Null Island" sentinel, which is what an uninitialised GPS stack reports.
 * A bus is never there, and drawing one there is worse than drawing none.
 */
export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return !(latitude === 0 && longitude === 0);
}

/** Wraps any angle into `[0, 360)`. Non-finite input → `null`, never `NaN`. */
export function normalizeHeading(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value)) return null;
  const wrapped = ((value % 360) + 360) % 360;
  return Number.isFinite(wrapped) ? wrapped : null;
}

/**
 * Signed shortest-path delta from one compass heading to another, in
 * `[-180, 180)`. This is what makes 359° → 1° a 2° turn instead of a 358°
 * spin, and it is the single place rotation direction is decided.
 *
 * Exactly 180° apart resolves to `-180` (counter-clockwise). Both directions
 * are equally short there, so the tie is broken deterministically rather than
 * left to floating-point luck.
 */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/** Position on the shortest arc between two headings. */
export function lerpAngle(fromDeg: number, toDeg: number, t: number): number {
  const delta = shortestAngleDelta(fromDeg, toDeg);
  return (((fromDeg + delta * t) % 360) + 360) % 360;
}

/** Linear interpolation, clamped — an out-of-range `t` must never extrapolate. */
export function lerp(from: number, to: number, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return from + (to - from) * clamped;
}

export function easeInOutCubic(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/**
 * Jitter gate derived from the device-reported accuracy.
 *
 * Half the accuracy radius: a fix is only believed to have *moved* the bus when
 * it moved further than the noise the device itself is reporting. Clamped to
 * 2 m (a good fix under 4 m accuracy still deserves to move the bus) and 30 m
 * (a very coarse fix must not freeze the bus for hundreds of metres — past
 * that we would be hiding real movement, which this module must never do).
 * `null` accuracy is treated as the floor, not as infinite noise.
 */
export function jitterThresholdMeters(accuracyMeters: number | null | undefined): number {
  const { jitterAccuracyFactor, jitterMinM, jitterMaxM } = MOTION_THRESHOLDS;
  if (!isFiniteNumber(accuracyMeters) || accuracyMeters < 0) return jitterMinM;
  return Math.min(jitterMaxM, Math.max(jitterMinM, accuracyMeters * jitterAccuracyFactor));
}

/** Tween length for the current cadence estimate, clamped to documented bounds. */
export function animationDurationMs(cadenceMs: number | null): number {
  const { animationCadenceFactor, animationMinMs, animationMaxMs, cadenceMinMs, cadenceMaxMs } =
    MOTION_THRESHOLDS;
  if (!isFiniteNumber(cadenceMs)) return animationMinMs;
  const bounded = Math.min(cadenceMaxMs, Math.max(cadenceMinMs, cadenceMs));
  return Math.min(animationMaxMs, Math.max(animationMinMs, bounded * animationCadenceFactor));
}

/**
 * Is the reported device heading trustworthy enough to drive the marker?
 *
 * Speed-gated on purpose: `expo-location` reports `heading: -1` when the
 * device has no course, and `buildLocationPayload` normalises that finite `-1`
 * into `359`. A stationary or crawling bus therefore can arrive with a heading
 * that is really "unknown". Requiring real speed makes that harmless — a bus
 * that is not moving keeps the heading it already had instead of spinning.
 */
export function isTrustworthyDeviceHeading(
  heading: number | null | undefined,
  speedKmh: number | null | undefined,
): heading is number {
  if (normalizeHeading(heading) === null) return false;
  return isFiniteNumber(speedKmh) && speedKmh >= MOTION_THRESHOLDS.headingMinSpeedKmh;
}

/**
 * The heading the marker should show, in priority order:
 *
 * 1. a trustworthy device heading (real speed, valid value);
 * 2. otherwise a bearing derived from two sufficiently separated accepted
 *    fixes — only when the displacement clears `headingMinDisplacementM`;
 * 3. otherwise **the previous heading**. Holding is the correct answer when
 *    the bus is stopped or the displacement is inside one accuracy circle:
 *    recomputing there is exactly what makes a parked bus visibly rotate.
 *
 * Returns `null` only when nothing has ever been established, in which case the
 * marker renders at 0° (north) and says nothing about direction.
 */
export function resolveHeading(input: {
  heading: number | null | undefined;
  speedKmh: number | null | undefined;
  from: { latitude: number; longitude: number } | null;
  to: { latitude: number; longitude: number };
  previous: number | null;
}): number | null {
  if (isTrustworthyDeviceHeading(input.heading, input.speedKmh)) {
    return normalizeHeading(input.heading);
  }
  if (input.from) {
    const displacement = haversineMeters(input.from, input.to);
    if (displacement >= MOTION_THRESHOLDS.headingMinDisplacementM) {
      return normalizeHeading(bearingDegrees(input.from, input.to));
    }
  }
  return input.previous;
}

// ── The state machine ──────────────────────────────────────────────────────

export interface BusMotionFix {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  recorded_at: string;
}

export interface RenderedBusPosition {
  latitude: number;
  longitude: number;
  /** Compass degrees `[0, 360)`, or `null` when no heading has been established. */
  headingDeg: number | null;
  /** True while a tween is running. Presentation only — not "the bus is moving". */
  moving: boolean;
  /**
   * The raw, unmodified source values. Anything that reports speed, accuracy or
   * "last updated" must read these — never the interpolated position above.
   */
  source: {
    latitude: number;
    longitude: number;
    speed: number | null;
    accuracy: number | null;
    recordedAtMs: number;
  };
}

export type BusMotionOutcome =
  | { action: 'animated'; distanceMeters: number; durationMs: number }
  | {
      action: 'snapped';
      reason: 'first-fix' | 'long-gap' | 'implausible-jump' | 'reduced-motion' | 'halted';
      distanceMeters: number;
    }
  | { action: 'held'; reason: 'jitter'; distanceMeters: number }
  | {
      action: 'ignored';
      reason: 'invalid-coordinate' | 'invalid-timestamp' | 'duplicate-or-out-of-order';
    };

export interface BusMotionOptions {
  /** Skip tweening entirely: positions snap. Used for reduced-motion. */
  reducedMotion?: boolean;
  thresholds?: Partial<typeof MOTION_THRESHOLDS>;
}

interface Tween {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  fromHeading: number | null;
  toHeading: number | null;
  startMs: number;
  durationMs: number;
}

/**
 * Creates one motion tracker. Exactly one instance per live map view: it owns
 * the rendered position, the heading and a *single* tween slot.
 *
 * There is deliberately **no queue**. When a fix arrives mid-tween the running
 * tween is discarded and a new one starts from wherever the marker currently
 * is on screen (`rendered`), so the bus can never fall several updates behind
 * or replay a burst of buffered fixes.
 */
export function createBusMotion(options: BusMotionOptions = {}) {
  const th = { ...MOTION_THRESHOLDS, ...(options.thresholds ?? {}) };

  /** Mutable so a mid-session OS preference change can be applied in place. */
  const reducedMotionRef = { current: options.reducedMotion === true };

  /** Last fix we accepted, whatever we decided to do with it visually. */
  let lastRecordedMs: number | null = null;
  /** Last position we committed the marker to (the jitter anchor). */
  let anchor: { latitude: number; longitude: number } | null = null;
  /** Where the marker actually is right now. */
  let rendered: { latitude: number; longitude: number } | null = null;
  let headingDeg: number | null = null;
  let tween: Tween | null = null;
  let cadenceMs: number | null = null;
  /** Frozen by `halt()` — stale/offline data must not keep sliding. */
  let halted = false;
  let source: RenderedBusPosition['source'] | null = null;

  /** Applies a mid-session OS "reduce motion" change without losing position. */
  function setReducedMotion(next: boolean): void {
    if (next === reducedMotionRef.current) return;
    reducedMotionRef.current = next;
    // Turning reduced motion ON while a tween runs must stop the travel
    // animation immediately rather than letting the current one play out.
    if (next) cancelAnimation();
  }

  /**
   * Feeds one received fix. Returns what the tracker decided to do with it, as
   * data — so a spec can assert on "held as jitter" without rendering anything.
   */
  function push(fix: BusMotionFix, nowMs: number): BusMotionOutcome {
    if (!isValidCoordinate(fix.latitude, fix.longitude)) {
      return { action: 'ignored', reason: 'invalid-coordinate' };
    }
    const recordedMs = new Date(fix.recorded_at).getTime();
    if (!Number.isFinite(recordedMs)) {
      return { action: 'ignored', reason: 'invalid-timestamp' };
    }

    // Duplicate / out-of-order: the server already de-duplicates by
    // idempotency key, but a REST snapshot can land after a newer socket push
    // (see `useLiveTripTracking`, which loads both in parallel). Comparing the
    // fix's own `recorded_at` is the existing timestamp semantics — a redelivered
    // or older fix never moves the marker backwards.
    if (lastRecordedMs !== null && recordedMs <= lastRecordedMs) {
      return { action: 'ignored', reason: 'duplicate-or-out-of-order' };
    }

    const gapMs = lastRecordedMs === null ? null : recordedMs - lastRecordedMs;
    if (gapMs !== null) {
      const bounded = Math.min(th.cadenceMaxMs, Math.max(th.cadenceMinMs, gapMs));
      cadenceMs =
        cadenceMs === null
          ? bounded
          : cadenceMs * (1 - th.cadenceSmoothing) + bounded * th.cadenceSmoothing;
    }
    lastRecordedMs = recordedMs;

    const next = { latitude: fix.latitude, longitude: fix.longitude };
    source = {
      latitude: fix.latitude,
      longitude: fix.longitude,
      speed: isFiniteNumber(fix.speed) && fix.speed >= 0 ? fix.speed : null,
      accuracy: isFiniteNumber(fix.accuracy) && fix.accuracy >= 0 ? fix.accuracy : null,
      recordedAtMs: recordedMs,
    };

    const first = rendered === null || anchor === null;
    const distanceMeters =
      anchor === null
        ? 0
        : haversineMeters(anchor, { latitude: fix.latitude, longitude: fix.longitude });

    // 1. First fix: draw it immediately. There is nothing to interpolate from,
    //    and a parent waiting for the bus should see it the instant it exists.
    if (first) {
      headingDeg = resolveHeading({
        heading: fix.heading,
        speedKmh: source.speed,
        from: null,
        to: next,
        previous: null,
      });
      anchor = next;
      rendered = next;
      tween = null;
      return { action: 'snapped', reason: 'first-fix', distanceMeters: 0 };
    }

    // 2. Jitter: inside the accuracy-derived gate the bus is not believed to
    //    have moved. `lastRecordedMs` still advanced above, so freshness and
    //    ordering stay correct while the marker holds still.
    const threshold = jitterThresholdMeters(source.accuracy);
    if (distanceMeters < threshold) {
      return { action: 'held', reason: 'jitter', distanceMeters };
    }

    const nextHeading = resolveHeading({
      heading: fix.heading,
      speedKmh: source.speed,
      from: anchor,
      to: next,
      previous: headingDeg,
    });

    // 3. Long gap: snap. Animating a minutes-old-to-now jump would show the bus
    //    racing, and would keep it animating long after the trip moved on.
    if (gapMs !== null && gapMs > th.gapSnapMs) {
      return commitSnap(next, nextHeading, 'long-gap', distanceMeters);
    }

    // 4. Implausible jump for the elapsed time: snap rather than race.
    if (gapMs !== null && gapMs > 0) {
      const impliedMps = distanceMeters / (gapMs / 1000);
      if (impliedMps > th.maxPlausibleSpeedMps) {
        return commitSnap(next, nextHeading, 'implausible-jump', distanceMeters);
      }
    }

    // 5. Halted (stale or offline data): the marker still has to *be* at the
    //    newest real fix, but it must not travel there. Creating a tween here
    //    would be worse than a jump — `sample` refuses to advance a tween while
    //    halted, so the frame loop would spin on a position that never moves.
    if (halted) {
      return commitSnap(next, nextHeading, 'halted', distanceMeters);
    }

    // 6. Reduced motion: the same destination, no travel animation.
    if (reducedMotionRef.current) {
      return commitSnap(next, nextHeading, 'reduced-motion', distanceMeters);
    }

    // 7. Normal case: tween from wherever the marker currently is on screen.
    const durationMs = animationDurationMs(cadenceMs);
    tween = {
      fromLat: rendered!.latitude,
      fromLng: rendered!.longitude,
      toLat: next.latitude,
      toLng: next.longitude,
      fromHeading: headingDeg,
      toHeading: nextHeading,
      startMs: nowMs,
      durationMs,
    };
    headingDeg = nextHeading;
    anchor = next;
    return { action: 'animated', distanceMeters, durationMs };
  }

  function commitSnap(
    next: { latitude: number; longitude: number },
    nextHeading: number | null,
    reason: 'long-gap' | 'implausible-jump' | 'reduced-motion' | 'halted',
    distanceMeters: number,
  ): BusMotionOutcome {
    tween = null;
    anchor = next;
    rendered = next;
    headingDeg = nextHeading;
    return { action: 'snapped', reason, distanceMeters };
  }

  /**
   * The position to draw at `nowMs`. Pure with respect to source data: it only
   * advances the tween, and once the tween completes it *is* the real fix.
   */
  function sample(nowMs: number): RenderedBusPosition | null {
    if (!rendered || !source) return null;

    if (tween && !halted) {
      const elapsed = nowMs - tween.startMs;
      const t = tween.durationMs <= 0 ? 1 : easeInOutCubic(elapsed / tween.durationMs);
      if (elapsed >= tween.durationMs) {
        rendered = { latitude: tween.toLat, longitude: tween.toLng };
        tween = null;
      } else {
        rendered = {
          latitude: lerp(tween.fromLat, tween.toLat, t),
          longitude: lerp(tween.fromLng, tween.toLng, t),
        };
        return {
          latitude: rendered.latitude,
          longitude: rendered.longitude,
          headingDeg:
            tween.fromHeading !== null && tween.toHeading !== null
              ? lerpAngle(tween.fromHeading, tween.toHeading, t)
              : headingDeg,
          moving: true,
          source,
        };
      }
    }

    return {
      latitude: rendered.latitude,
      longitude: rendered.longitude,
      headingDeg,
      moving: false,
      source,
    };
  }

  /**
   * Stops travel animation and freezes on the last known position.
   *
   * Called when the data goes stale or the socket drops: a marker that keeps
   * sliding while the label says "last known" would be a lie. The position is
   * retained and labelled, never cleared and never extrapolated.
   */
  function halt(): void {
    if (tween) {
      rendered = { latitude: tween.toLat, longitude: tween.toLng };
      tween = null;
    }
    halted = true;
  }

  /** Resumes tweening after fresh data arrives again. */
  function resume(): void {
    halted = false;
  }

  /**
   * Drops everything: trip switch, logout, unmount, or a foreground resume that
   * must reconcile with current data rather than replay missed movement.
   */
  function reset(): void {
    lastRecordedMs = null;
    anchor = null;
    rendered = null;
    headingDeg = null;
    tween = null;
    cadenceMs = null;
    source = null;
    halted = false;
  }

  /** Cancels any running tween without discarding the last known position. */
  function cancelAnimation(): void {
    if (tween) {
      rendered = { latitude: tween.toLat, longitude: tween.toLng };
      tween = null;
    }
  }

  function isAnimating(): boolean {
    return tween !== null;
  }

  function cadence(): number | null {
    return cadenceMs;
  }

  return {
    push,
    sample,
    halt,
    resume,
    reset,
    cancelAnimation,
    setReducedMotion,
    isAnimating,
    cadence,
  };
}

export type BusMotion = ReturnType<typeof createBusMotion>;
