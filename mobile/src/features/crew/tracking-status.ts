import { GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS } from '@school-bus-tracking/shared-types';
import type { PermissionState } from './gps-permission-state.ts';

/**
 * The one honest answer to "can the school see my bus right now?".
 *
 * Before this patch the crew surfaces showed a locally obtained GPS fix as
 * "Updated 5s ago" even when the socket was down and the server had never
 * accepted anything — and the Android foreground-service notification claimed
 * "The school can see the live bus position". Both were untrue whenever the
 * device had a fix but no acknowledged delivery.
 *
 * Everything here is derived from **two different clocks**:
 *
 * - `lastLocalFixAt` — the device produced a coordinate (proof of GPS only);
 * - `lastServerAckAt` — the server accepted a fix (`trip:location:update` ack
 *   `accepted`), which is the only evidence that anyone else can see it.
 *
 * The states are deliberately separable so the UI can age, reconnect and
 * report a permission problem without ever conflating "I have a fix" with
 * "the school has my position".
 */

/** Connection state of the crew tracking socket, as the controller sees it. */
export type TrackingConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  /** The bounded recovery budget is exhausted — waiting for a new trigger. */
  | 'gave-up'
  /** Access permanently revoked (tenant/user deactivated). */
  | 'revoked';

/** What the driver is told, in words that cannot overpromise. */
export type CrewTrackingStatus =
  /** Nothing is running: no foreground watch, no background task. */
  | 'stopped'
  /** The OS location switch is off — no fix is possible at all. */
  | 'services-off'
  /** Location permission is missing/denied. */
  | 'permission-blocked'
  /** Access was permanently revoked for this account/tenant. */
  | 'revoked'
  /** Running, socket still establishing (first connect after start/recovery). */
  | 'connecting'
  /** Running, socket lost and recovery is retrying inside its budget. */
  | 'reconnecting'
  /** Connected and permitted, but the device has produced no fix yet. */
  | 'waiting-for-fix'
  /**
   * The device has a fresh fix the **server has not acknowledged** — GPS works,
   * delivery does not. Never reported as "the school can see you".
   */
  | 'local-only'
  /** The server acknowledged a fix inside the live window: genuinely visible. */
  | 'live'
  /** The server acknowledged something before, but nothing recent. */
  | 'stale';

/**
 * Delivery freshness — **when a server acknowledgement counts as current**.
 *
 * The value comes from `@school-bus-tracking/shared-types`, the product's single
 * definition of GPS freshness, so the driver's screen and the parent's map can
 * never disagree about whether the same bus is live. The named re-export is
 * deliberate: `SERVER_ACK_LIVE_WINDOW_MS` is an *acknowledgement* window that
 * happens to share a duration with the observer window and with
 * `LOCAL_FIX_FRESH_WINDOW_MS` — three different questions, three different
 * concepts, one agreed number.
 *
 * It used to be a literal here pinned to the observer value by
 * `map/tracking-presentation.spec.ts`; that made the two able to drift apart and
 * be caught only by a test. Importing the shared constant removes the drift
 * instead of detecting it, without moving any threshold.
 */
export const SERVER_ACK_LIVE_WINDOW_MS = GPS_LIVE_WINDOW_MS;

/** Beyond the live window but inside this, an acknowledged update is "stale". */
export const SERVER_ACK_STALE_WINDOW_MS = GPS_STALE_WINDOW_MS;

/**
 * **Local** fix freshness: a fix *this device produced* counts as "the device
 * has GPS right now".
 *
 * Deliberately its own constant rather than another alias of the shared window.
 * It answers a different question — "is this phone's GPS working", not "can
 * anyone else see it" — and it is the only evidence that may produce
 * `local-only`. Sharing a duration with the delivery window is a coincidence of
 * the same 4 s watch cadence, not a coupling; changing one must not silently
 * change the other, which is exactly what a shared constant would do.
 */
export const LOCAL_FIX_FRESH_WINDOW_MS = 30_000;

export interface CrewTrackingStatusInput {
  foregroundActive: boolean;
  backgroundActive: boolean;
  foregroundPermission: PermissionState;
  servicesEnabled: boolean | null;
  connection: TrackingConnectionState;
  lastLocalFixAt: string | null;
  lastServerAckAt: string | null;
  /** Injectable clock — the UI ticks it so indicators age without new data. */
  now: number;
  liveWindowMs?: number;
  staleWindowMs?: number;
  localFreshWindowMs?: number;
}

export interface CrewTrackingStatusResult {
  status: CrewTrackingStatus;
  /** Age of the newest server-acknowledged fix, or `null` when never acked. */
  serverAckAgeMs: number | null;
  /** Age of the newest local device fix, or `null` when none. */
  localFixAgeMs: number | null;
  /**
   * The only flag that may drive "the school can see the live bus position"
   * copy: a server acknowledgement inside the live window.
   */
  schoolSeesLive: boolean;
  /** True while recovery is retrying (network or expired auth). */
  recovering: boolean;
  /** True when the bounded recovery budget ran out. */
  recoveryExhausted: boolean;
}

function ageMs(iso: string | null, now: number): number | null {
  if (!iso) {
    return null;
  }
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  return now - time;
}

/** Derives the driver-facing tracking status from facts, never from hope. */
export function deriveCrewTrackingStatus(input: CrewTrackingStatusInput): CrewTrackingStatusResult {
  const liveWindowMs = input.liveWindowMs ?? SERVER_ACK_LIVE_WINDOW_MS;
  const staleWindowMs = input.staleWindowMs ?? SERVER_ACK_STALE_WINDOW_MS;
  const localFreshWindowMs = input.localFreshWindowMs ?? LOCAL_FIX_FRESH_WINDOW_MS;

  const serverAckAgeMs = ageMs(input.lastServerAckAt, input.now);
  const localFixAgeMs = ageMs(input.lastLocalFixAt, input.now);
  const running = input.foregroundActive || input.backgroundActive;

  const result = (status: CrewTrackingStatus): CrewTrackingStatusResult => ({
    status,
    serverAckAgeMs,
    localFixAgeMs,
    schoolSeesLive: status === 'live',
    // Recovery state is a property of the connection, not of the headline: a
    // socket that dropped while the last ack is still fresh reads as `live`
    // *and* `recovering`, which is exactly what the driver needs to see.
    recovering: input.connection === 'connecting' || input.connection === 'reconnecting',
    recoveryExhausted: input.connection === 'gave-up',
  });

  if (input.connection === 'revoked') {
    return result('revoked');
  }
  if (!running) {
    return result('stopped');
  }
  if (input.servicesEnabled === false) {
    return result('services-off');
  }
  if (input.foregroundPermission !== 'granted') {
    return result('permission-blocked');
  }

  // 1. A recent server acknowledgement is the only "live" evidence.
  if (serverAckAgeMs !== null && serverAckAgeMs <= liveWindowMs) {
    return result('live');
  }

  // 2. No live ack: report the connection honestly before blaming the GPS.
  if (input.connection === 'connecting') {
    return result('connecting');
  }
  if (input.connection === 'reconnecting' || input.connection === 'gave-up') {
    return result('reconnecting');
  }

  // 3. Connected, acknowledged before, nothing recent.
  if (serverAckAgeMs !== null && serverAckAgeMs <= staleWindowMs) {
    return result('stale');
  }

  // 4. Connected, a fresh local fix the server never accepted.
  if (localFixAgeMs !== null && localFixAgeMs <= localFreshWindowMs) {
    return result('local-only');
  }

  // 5. Connected, permitted, and nothing at all yet.
  if (serverAckAgeMs !== null) {
    return result('stale');
  }
  return result('waiting-for-fix');
}

/** Coarse age bucket for labels that must keep ageing without new data. */
export type FreshnessBucket = 'none' | 'just-now' | 'seconds' | 'minutes' | 'hours' | 'old';

/** Buckets an age in ms so a label can age on a timer tick alone. */
export function freshnessBucket(ageMsValue: number | null): FreshnessBucket {
  if (ageMsValue === null || !Number.isFinite(ageMsValue)) {
    return 'none';
  }
  if (ageMsValue < 0) {
    return 'just-now';
  }
  if (ageMsValue < 10_000) {
    return 'just-now';
  }
  if (ageMsValue < 60_000) {
    return 'seconds';
  }
  if (ageMsValue < 60 * 60_000) {
    return 'minutes';
  }
  if (ageMsValue < 24 * 60 * 60_000) {
    return 'hours';
  }
  return 'old';
}

/** Formats an age in ms into the human string a status line interpolates. */
export type StatusAgeFormatter = (ageMs: number | null) => string;

/**
 * The single line the trip screen shows. It names what is *known*, and it is
 * never "the school can see you" unless a server ack is inside the live window.
 *
 * Returns an i18n key + params so the copy stays translatable; the component
 * resolves it with `t()`. `formatAge` is injected (the caller owns the locale
 * aware relative-time formatting), which keeps this module pure.
 */
export function crewTrackingStatusCopy(input: {
  status: CrewTrackingStatus;
  serverAckAgeMs: number | null;
  localFixAgeMs: number | null;
  formatAge: StatusAgeFormatter;
}): { key: CrewTrackingCopyKey; params: Record<string, string | number> } {
  const ack = input.formatAge(input.serverAckAgeMs);
  const fix = input.formatAge(input.localFixAgeMs);

  switch (input.status) {
    case 'live':
      return { key: 'gps.status.live', params: { time: ack } };
    case 'local-only':
      return { key: 'gps.status.localOnly', params: { time: fix } };
    case 'connecting':
      return { key: 'gps.status.connecting', params: {} };
    case 'reconnecting':
      return { key: 'gps.status.reconnecting', params: {} };
    case 'stale':
      return { key: 'gps.status.stale', params: { time: ack } };
    case 'waiting-for-fix':
      return { key: 'gps.status.waitingForFix', params: {} };
    case 'permission-blocked':
      return { key: 'gps.status.permissionBlocked', params: {} };
    case 'services-off':
      return { key: 'gps.status.servicesOff', params: {} };
    case 'revoked':
      return { key: 'gps.status.revoked', params: {} };
    case 'stopped':
    default:
      return { key: 'gps.status.stopped', params: {} };
  }
}

/** Translation keys the status line can use (checked against the dictionary). */
export type CrewTrackingCopyKey =
  | 'gps.status.live'
  | 'gps.status.localOnly'
  | 'gps.status.connecting'
  | 'gps.status.reconnecting'
  | 'gps.status.stale'
  | 'gps.status.waitingForFix'
  | 'gps.status.permissionBlocked'
  | 'gps.status.servicesOff'
  | 'gps.status.revoked'
  | 'gps.status.stopped'
  | 'gps.status.tripNotEligible'
  | 'gps.status.cannotReachServer';

/**
 * The host part of an API base URL — for copy that must name *which* server
 * the app talks to without leaking anything else.
 *
 * `URL().host` is deliberately the whole extraction: it keeps scheme+host+port
 * (nothing) — just `host:port`, with any userinfo, path, query and fragment
 * dropped. A misconfigured `EXPO_PUBLIC_API_URL` carrying a token in the query
 * string or in userinfo therefore can never reach a driver-facing line or the
 * diagnostics card through this helper. `null` (no configured URL) is the
 * honest answer, never a guess.
 */
export function apiHost(apiBaseUrl: string | null | undefined): string | null {
  if (!apiBaseUrl) {
    return null;
  }
  try {
    const host = new URL(apiBaseUrl).host;
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/**
 * The status line with the lifecycle's stop/recovery context layered on.
 *
 * `crewTrackingStatusCopy` answers "what is the delivery doing right now"
 * from status + ages alone. These two facts need extra lifecycle state and are
 * exactly the ones a driver cannot diagnose:
 *
 * - tracking stopped because the **server** says the trip no longer accepts
 *   GPS — say so, with the server's status (`{status}` is data, not copy);
 * - the bounded reconnect budget is exhausted (`gave-up`) — the remaining
 *   question is reachability, so name the school server's host (`{host}` is
 *   `apiHost`, never the full URL).
 *
 * Everything else falls through to `crewTrackingStatusCopy` unchanged.
 */
export function crewTrackingStatusLine(input: {
  status: CrewTrackingStatus;
  serverAckAgeMs: number | null;
  localFixAgeMs: number | null;
  formatAge: StatusAgeFormatter;
  /** Why tracking last stopped (lifecycle state; `null` while running). */
  lastStopReason?: string | null;
  /** Server trip status recorded with a `trip-not-eligible` stop, if any. */
  lastStopTripStatus?: string | null;
  /** Lifecycle connection state (for the `gave-up` line). */
  connection?: TrackingConnectionState;
  /** The API base URL, for the host in the `gave-up` line. */
  apiBaseUrl?: string | null;
}): { key: CrewTrackingCopyKey; params: Record<string, string | number> } {
  const base = crewTrackingStatusCopy({
    status: input.status,
    serverAckAgeMs: input.serverAckAgeMs,
    localFixAgeMs: input.localFixAgeMs,
    formatAge: input.formatAge,
  });

  if (
    input.status === 'stopped' &&
    input.lastStopReason === 'trip-not-eligible' &&
    input.lastStopTripStatus
  ) {
    return { key: 'gps.status.tripNotEligible', params: { status: input.lastStopTripStatus } };
  }

  if (input.connection === 'gave-up') {
    const host = apiHost(input.apiBaseUrl);
    if (host) {
      return { key: 'gps.status.cannotReachServer', params: { host } };
    }
    // No configured host to name (dev default not resolved yet): fall through
    // to the honest reconnecting/stopped word rather than a fake address.
  }

  return base;
}

/** Tone for the status badge: colour is never the only cue, the word repeats it. */
export function crewTrackingStatusTone(
  status: CrewTrackingStatus,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'live':
      return 'success';
    case 'connecting':
    case 'reconnecting':
    case 'waiting-for-fix':
    case 'local-only':
    case 'stale':
      return 'warning';
    case 'permission-blocked':
    case 'services-off':
    case 'revoked':
      return 'danger';
    case 'stopped':
    default:
      return 'neutral';
  }
}
