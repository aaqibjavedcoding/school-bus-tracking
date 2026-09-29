/**
 * Bounded retry + recovery policy for the map-style pipeline (deep-fix R3).
 *
 * ### The failure this exists for
 *
 * The style JSON is one small fetch, but on mobile data it is the classic
 * flaky first request: the radio is still warm, the CDN edge is waking, or
 * the phone just walked out of a tunnel. The pipeline used to treat one
 * failure as final — a permanent `map.issue.styleLoad` line and a dead map
 * until the app restarted. One transient failure must never be a verdict.
 *
 * ### The policy
 *
 * Retry with a **bounded** backoff — `[2 s, 5 s, 15 s]` — shared by both
 * failure sites (`use-map-style.ts`):
 *
 * 1. the JS style-JSON fetch: `runWithBackoff` runs the attempt, waits
 *    `delaysMs[i]` between attempts, and gives up after `delays.length + 1`
 *    attempts (4 total ≈ 22 s worst case, well inside the ~20 s field
 *    acceptance for a blip that clears);
 * 2. the native engine's own style load (`onDidFailLoadingMap`):
 *    `planStyleLoadFailure` turns "the engine said the style failed, again"
 *    into the same bounded sequence of re-set attempts, then the offline
 *    fallback — and into `wait` when a recovery is already in flight, so two
 *    failure sources can never double-schedule a retry storm.
 *
 * Bounded means bounded: when the budget is spent the pipeline drops to the
 * bundled offline style (a deliberate, labelled base map — see
 * `map-style.ts`), reports the issue and **stops**. A dead-zone phone must
 * not burn battery retrying forever, and a later successful load (a remount,
 * a re-set that lands) is what clears the line — see `map-diagnostics.ts`.
 *
 * ### Pure, ports injected
 *
 * No React, no native imports, no real timers: the sleeper and the attempt
 * are parameters (the same port-injection pattern as
 * `follow-camera-controller.ts`'s `FollowCameraPort`), so
 * `map-style-recovery.spec.ts` drives the whole policy with `node --test`
 * mock timers — no real network, no real sleeps.
 */

/**
 * The shared backoff schedule, in milliseconds. Increasing, because the
 * plausible causes (radio warm-up, edge cold start, captive portal) are
 * ordered cheap-check-first; capped at three gaps, because past ~22 s offline
 * the honest answer is the fallback base map, not a fourth hope.
 */
export const STYLE_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

/**
 * The production sleeper, isolated so specs never depend on it. Everything
 * that schedules in this module goes through this one function, and specs
 * inject their own (mock-timer) sleeper instead.
 */
export const realSleep: (delayMs: number) => Promise<void> = (delayMs) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

/** Thrown by `runWithBackoff` when the caller cancels between attempts. */
export class BackoffCancelledError extends Error {
  constructor() {
    super('backoff cancelled');
    this.name = 'BackoffCancelledError';
  }
}

export interface BackoffPorts<T> {
  /**
   * One attempt, called with its 0-based attempt index. Rejection (or a
   * thrown value) classifies the attempt as failed; there is no permanent/
   * transient distinction — a bounded budget makes the distinction moot.
   */
  attempt: (attemptIndex: number) => Promise<T>;
  /** Between-attempt wait. Defaults to `realSleep`; specs inject a fake. */
  sleep?: (delayMs: number) => Promise<void>;
  /** The backoff schedule. Defaults to `STYLE_RETRY_DELAYS_MS`. */
  delaysMs?: readonly number[];
  /** Checked before every attempt and after every wait. */
  isCancelled?: () => boolean;
}

/**
 * Runs `attempt`, waiting `delaysMs[i]` before attempt `i + 1`, for at most
 * `delaysMs.length + 1` attempts.
 *
 * Resolves with the first success. Rejects with the **last** failure once the
 * budget is spent (the last failure is the freshest diagnosis). All timers
 * belong to the injected `sleep`, so a spec owns them completely.
 */
export async function runWithBackoff<T>(ports: BackoffPorts<T>): Promise<T> {
  const delays = ports.delaysMs ?? STYLE_RETRY_DELAYS_MS;
  const sleep = ports.sleep ?? realSleep;
  let lastFailure: unknown = new Error('no attempts were made');
  for (let index = 0; index <= delays.length; index += 1) {
    if (ports.isCancelled?.() === true) throw new BackoffCancelledError();
    try {
      return await ports.attempt(index);
    } catch (failure) {
      lastFailure = failure;
    }
    if (index < delays.length) {
      await sleep(delays[index]);
    }
  }
  throw lastFailure;
}

/**
 * What the pipeline should do when the **native engine** reports a style
 * load failure (`onDidFailLoadingMap` / a classified native error log):
 *
 * - `retry { delayMs }` — schedule a style re-set after this wait;
 * - `fallback` — the bounded budget is spent: drop to the bundled offline
 *   base style (loadable with zero network) and stop retrying;
 * - `wait` — do nothing: either a recovery is already in flight (this event
 *   will be superseded by its outcome) or the offline fallback is already
 *   showing (nothing left to try; the issue line already names the cause).
 */
export type MapStyleFailureAction =
  | { kind: 'retry'; delayMs: number }
  | { kind: 'fallback' }
  | { kind: 'wait' };

export interface StyleLoadFailureInput {
  /** The offline fallback is what the map is currently showing. */
  showingFallback: boolean;
  /** A fetch pipeline or a scheduled re-set is already running. */
  recoveryInFlight: boolean;
  /** Consecutive native failures since the last successful load. */
  consecutiveFailures: number;
  /** The backoff schedule. Defaults to `STYLE_RETRY_DELAYS_MS`. */
  delaysMs?: readonly number[];
}

/**
 * The decision table for one native failure event. Kept pure so the hook's
 * branch is a lookup, and so the "one recovery at a time" and "bounded means
 * bounded" rules are pinned by specs rather than re-derived at the callsite.
 */
export function planStyleLoadFailure(input: StyleLoadFailureInput): MapStyleFailureAction {
  if (input.showingFallback) return { kind: 'wait' };
  if (input.recoveryInFlight) return { kind: 'wait' };
  const delays = input.delaysMs ?? STYLE_RETRY_DELAYS_MS;
  if (input.consecutiveFailures < delays.length) {
    return { kind: 'retry', delayMs: delays[input.consecutiveFailures] };
  }
  return { kind: 'fallback' };
}
