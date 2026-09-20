/**
 * Which buttons the driver's compact GPS strip offers, decided from the
 * lifecycle state alone (pure, node-testable).
 *
 * The strip used to show one button — labelled **"Retry"** — whenever nothing
 * was running, including the very first time on a fresh trip. A driver who had
 * never shared anything read "Retry" as "something is broken", not as "tap
 * here to put the bus on the school's map", and drove with sharing off. The
 * words now say what the tap does:
 *
 * - `share` — nothing is running and nothing failed: **Share GPS** (start).
 * - `retry` — nothing is running because the last run **failed** (a permanent
 *   server rejection, a revoked session, a refused start such as a denied
 *   permission), so the tap is a genuine retry.
 * - `stop` — a run is active: **Stop** (and, when the bounded reconnect budget
 *   is exhausted, an additional **Retry** that forces one recovery pass — the
 *   "gave-up" state is real, and only a new trigger leaves it).
 *
 * Stops the crew member chose, or that the trip/session lifecycle made on their
 * behalf, are not failures: after them the next tap is a plain start again.
 */

export type GpsStripAction = 'share' | 'retry' | 'stop';

export interface GpsStripInput {
  /** A foreground watch is running on this device. */
  foregroundActive: boolean;
  /** The OS background-location task is started. */
  backgroundActive: boolean;
  /** Why tracking last stopped (`null` while running / never started). */
  lastStopReason: string | null;
  /** The bounded reconnect budget is used up (`connection === 'gave-up'`). */
  recoveryExhausted: boolean;
  /** A start/refused-permission message the lifecycle is currently showing. */
  message: string | null;
}

export interface GpsStripActions {
  /** The primary (largest) button. */
  primary: GpsStripAction;
  /** A secondary Retry next to Stop while a run has given up reconnecting. */
  showRetryWhileRunning: boolean;
}

/**
 * Stop reasons that are *not* failures: the driver, the trip lifecycle or the
 * session ended the run on purpose (`tracking-lifecycle.ts` /
 * `useCrewLocationSharing.ts` are the writers of these strings).
 */
export const CHOSEN_STOP_REASONS: ReadonlySet<string> = new Set([
  'user',
  'trip-closed',
  'session-ended',
  'account-changed',
]);

export function gpsStripActions(input: GpsStripInput): GpsStripActions {
  const running = input.foregroundActive || input.backgroundActive;
  if (running) {
    return { primary: 'stop', showRetryWhileRunning: input.recoveryExhausted };
  }
  const failedStart = input.message !== null;
  const failedRun = input.lastStopReason !== null && !CHOSEN_STOP_REASONS.has(input.lastStopReason);
  return {
    primary: failedStart || failedRun || input.recoveryExhausted ? 'retry' : 'share',
    showRetryWhileRunning: false,
  };
}
