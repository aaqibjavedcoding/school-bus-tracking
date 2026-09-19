import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { FRAME_MIN_INTERVAL_MS, createBusMotion, type BusMotion } from './bus-motion.ts';
import type { LiveFix } from '../tracking/useLiveTripTracking';

/**
 * Drives the marker's rendered position from the raw GPS stream.
 *
 * ### Where the frames live
 *
 * This hook is used **only inside `BusMarker`, a leaf component that renders a
 * single `<Marker>`**. The ~20 fps state updates therefore re-render one marker,
 * never the tracking screen, and nothing here writes to a store: a global store
 * updated per frame would re-render every subscriber twenty times a second.
 *
 * Per-frame *camera* movement is kept off React entirely — the optional
 * `onFrame` callback lets the map move its camera imperatively through a ref
 * (see `BusMap`), so no component re-renders for the camera at all.
 *
 * ### What it never does
 *
 * - It never writes an interpolated coordinate back into `fix`. Everything the
 *   screen reports — ETA, stop progress, speed, "updated 4 s ago" — keeps
 *   reading the raw `LiveFix` this hook was handed.
 * - It never extrapolates. The tween always ends *on* a received fix.
 * - It never replays. A background→foreground transition reconciles with the
 *   current fix; the frames that were missed while backgrounded are dropped.
 */

export interface RenderedMarker {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  moving: boolean;
}

export interface UseBusMarkerMotionInput {
  /** The newest raw fix, exactly as the tracking hook delivered it. */
  fix: LiveFix | null;
  /** Changing trip must drop every position from the previous bus. */
  tripId: string | null;
  /** OS reduce-motion preference: positions snap instead of travelling. */
  reducedMotion: boolean;
  /**
   * Whether travel animation is allowed. Driven by GPS freshness, not by the
   * socket: a stale position is frozen and labelled, never left sliding.
   */
  animate: boolean;
  /** Imperative per-frame hook for the follow camera. Not a React callback. */
  onFrame?: (marker: RenderedMarker) => void;
}

export function useBusMarkerMotion(input: UseBusMarkerMotionInput): RenderedMarker | null {
  const { fix, tripId, reducedMotion, animate, onFrame } = input;
  const [marker, setMarker] = useState<RenderedMarker | null>(null);

  const motionRef = useRef<BusMotion | null>(null);
  if (motionRef.current === null) {
    motionRef.current = createBusMotion({ reducedMotion });
  }
  const motion = motionRef.current;

  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const stopLoop = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  const publish = (nowMs: number) => {
    const next = motion.sample(nowMs);
    if (!next) return;
    const rendered: RenderedMarker = {
      latitude: next.latitude,
      longitude: next.longitude,
      headingDeg: next.headingDeg,
      moving: next.moving,
    };
    setMarker((previous) =>
      previous !== null &&
      previous.latitude === rendered.latitude &&
      previous.longitude === rendered.longitude &&
      previous.headingDeg === rendered.headingDeg &&
      previous.moving === rendered.moving
        ? previous
        : rendered,
    );
    onFrameRef.current?.(rendered);
  };

  const startLoop = () => {
    if (frameRef.current !== null) return;
    const tick = (nowMs: number) => {
      frameRef.current = null;
      // Frame cap: a bus at 40 km/h covers ~0.55 m in 50 ms, which is sub-pixel
      // at tracking-card zoom, so rendering faster than this only costs frames.
      if (nowMs - lastFrameAtRef.current >= FRAME_MIN_INTERVAL_MS) {
        lastFrameAtRef.current = nowMs;
        publish(nowMs);
      }
      if (motion.isAnimating()) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  // Trip switch / logout: drop everything from the previous bus, including the
  // rendered position, so the new trip's first fix is treated as a first fix
  // and snaps instead of tweening in from the old bus's location.
  useEffect(() => {
    motion.reset();
    stopLoop();
    setMarker(null);
    lastFrameAtRef.current = 0;
    // `motion` is stable for the component's lifetime; the trip is what changed.
  }, [tripId]);

  // Reduced motion can change while the app is open; apply it in place and
  // cancel a tween that is already running.
  useEffect(() => {
    motion.setReducedMotion(reducedMotion);
    stopLoop();
    publish(performanceNow());
  }, [reducedMotion]);

  // Freshness: a stale or offline position must stop travelling.
  useEffect(() => {
    if (animate) {
      motion.resume();
    } else {
      motion.halt();
      stopLoop();
      publish(performanceNow());
    }
  }, [animate]);

  // A new fix: feed the state machine and animate only if it decided to.
  useEffect(() => {
    if (!fix) return;
    const nowMs = performanceNow();
    const outcome = motion.push(
      {
        latitude: fix.latitude,
        longitude: fix.longitude,
        heading: fix.heading,
        speed: fix.speed,
        accuracy: fix.accuracy,
        recorded_at: fix.recorded_at,
      },
      nowMs,
    );
    lastFrameAtRef.current = nowMs;
    publish(nowMs);
    // A duplicate / out-of-order / invalid fix produces no movement and must
    // not restart a tween that is already correctly in flight.
    if (outcome.action === 'animated') startLoop();
  }, [fix?.latitude, fix?.longitude, fix?.recorded_at]);

  // Lifecycle: backgrounding stops the loop (no point burning frames nobody
  // sees, and none would run anyway). Returning reconciles with the current
  // data — it does not replay the movement that happened while away.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        publish(performanceNow());
        if (motion.isAnimating()) startLoop();
        return;
      }
      motion.cancelAnimation();
      stopLoop();
      publish(performanceNow());
    });
    return () => subscription.remove();
  }, []);

  // Unmount: nothing may keep requesting frames after the view is gone.
  useEffect(() => {
    return () => {
      motion.cancelAnimation();
      stopLoop();
    };
  }, []);

  return marker;
}

/**
 * Monotonic clock for animation timing.
 *
 * `performance.now()` is available on Hermes and in the browser; falling back
 * to `Date.now()` keeps this module loadable (and spec-runnable) under plain
 * `node --test`, where `performance` may be absent. The two are interchangeable
 * here because only *differences* are ever used.
 */
function performanceNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}
