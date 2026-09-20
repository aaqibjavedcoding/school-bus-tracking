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
 *
 * The two repair actions (`open-settings`, `request-permission`) exist so a
 * refused start shows a tap that fixes the *named* problem — the lifecycle's
 * message says "location permission is required", and the button must then be
 * the permission request, not a second "Retry" that fails the same way.
 */

import type { PermissionState } from './gps-permission-state.ts';

export type GpsStripAction =
  | 'share'
  | 'retry'
  | 'stop'
  /** The OS location switch is off or the permission is permanently denied —
   *  only the OS settings screen can fix that, so the tap opens it. */
  | 'open-settings'
  /** The permission was asked and refused (or never asked) but can be asked
   *  again in-app — the tap fires the OS permission request. */
  | 'request-permission';

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
  /** OS location switch state (`null` when the platform would not answer). */
  servicesEnabled?: boolean | null;
  /** Coarse foreground location permission state (see `mapPermissionState`). */
  foregroundPermission?: PermissionState;
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

  // Nothing running: OS-side blockers beat "retry". A previous failure message
  // may name the problem ("location permission is required"), but re-running
  // the start is not the fix — opening the OS settings or asking the
  // permission again is. Precedence mirrors `evaluateGpsPermissions`.
  if (input.servicesEnabled === false || input.foregroundPermission === 'denied') {
    return { primary: 'open-settings', showRetryWhileRunning: false };
  }
  if (input.foregroundPermission === 'undetermined' && input.message !== null) {
    // Refused (or never asked) but the OS will still answer an in-app request:
    // the tap asks, and a grant completes the start the driver already asked
    // for. A plain denial that can be asked again maps to 'undetermined', so
    // this is exactly the "ask again" case.
    return { primary: 'request-permission', showRetryWhileRunning: false };
  }

  const failedStart = input.message !== null;
  const failedRun = input.lastStopReason !== null && !CHOSEN_STOP_REASONS.has(input.lastStopReason);
  return {
    primary: failedStart || failedRun || input.recoveryExhausted ? 'retry' : 'share',
    showRetryWhileRunning: false,
  };
}
