import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  LIVE_TRACKING_EVENTS,
  TripStatus,
  type TripLocationUpdateAck,
  type TripLocationUpdatePayload,
} from '@school-bus-tracking/shared-types';

// Side-effect import: registers the native API environment (platform + Metro
// dev host) **from the tracking module itself**. A headless background-task
// execution runs in a fresh JS process where no React screen is mounted, so
// `app/_layout.tsx` (which used to be the only importer) may never be
// evaluated — and without registration every API/socket call would resolve
// against the pre-registration default. Importing it here makes recovery
// independent of the UI tree.
import '../../services/api-env.ts';

// Side-effect import: registers the runtime facts (Expo Go vs development
// build vs standalone) for the same reason — the headless task must know
// whether the OS background-location task can exist here **before** it asks
// the SDK, because in Expo Go those calls warn (LogBox) instead of answering.
import '../../lib/runtime-env.ts';

import { apiClient } from '../../services/api.ts';
import { getLiveTrackingSocket } from '../../services/live-tracking-socket.ts';
import { getAccessToken } from '../../services/session.ts';
import { invalidateSessionRecovery, recoverSession } from '../../services/session-recovery.ts';
import {
  SESSION_REVOKED_EVENT,
  classifyLocationAck,
  classifySocketDisconnect,
  connectSocketWithBound,
  createRecoveryPolicy,
  emitWithAckBound,
  isPermanentLocationRejection,
  type SocketDisconnectClass,
} from '../../services/socket-recovery.ts';
import { buildLocationPayload, type DeviceLocationFix } from '../../lib/geo.ts';
import { generateIdempotencyKey } from '../../lib/idempotency.ts';
import { getApiErrorMessage } from '../../lib/errors.ts';
import { t } from '../../lib/i18n.ts';
import { backgroundUnavailableReasonFor, getRuntime } from '../../lib/runtime-environment.ts';
import {
  CREW_TRACKING_CONTEXT_KEY,
  LEGACY_CREW_ACTIVE_TRIP_KEY,
  createCrewTrackingContext,
  decideTrackingContextRestore,
  serializeCrewTrackingContext,
  type TrackingContextDecision,
} from './tracking-context.ts';
import {
  acknowledgePendingFix,
  initialPendingFixState,
  offerPendingFix,
  takePendingFix,
  type PendingFixState,
} from './pending-fix.ts';
import {
  deriveCrewTrackingStatus,
  type CrewTrackingStatusResult,
  type TrackingConnectionState,
} from './tracking-status.ts';
import {
  evaluateGpsPermissions,
  locationAccuracyAuthorization,
  mapPermissionState,
  type GpsIssue,
  type LocationAccuracyAuthorization,
  type PermissionState,
} from './gps-permission-state.ts';

/**
 * The crew tracking lifecycle — **one** owner for GPS sharing, connectivity and
 * recovery, shared by every screen and by the headless background task.
 *
 * Why a module singleton instead of a hook: `useCrewLocationSharing` used to be
 * instantiated independently by the Trip screen and the Help screen, so each
 * mount created its own `watchPositionAsync` subscription and each unmount
 * could stop a stream the other screen still believed was running. There is now
 * exactly one watcher, one background task, one socket connection controller
 * and one status — screens subscribe to it and forward user actions.
 *
 * What it guarantees:
 *
 * - **connectivity before delivery**: a fix is only emitted on a connected,
 *   authenticated socket. Otherwise it goes into the bounded pending slot
 *   (`pending-fix.ts`) and a bounded recovery run is scheduled;
 * - **headless recovery**: `runHeadlessCrewLocationTask()` registers the API
 *   runtime, recovers the session through the existing cookie-based refresh
 *   (single-flight, bounded), restores the *owned* tracking context, re-checks
 *   trip eligibility against the server, connects, and only then delivers;
 * - **no cross-account leakage**: the persisted context carries `userId` /
 *   `schoolId` and is refused when it does not match the recovered session;
 *   logout and account switching cancel recovery, drop pending fixes and clear
 *   the context (an epoch counter also makes late async completions no-ops);
 * - **bounded everything**: connect, ack, eligibility and refresh waits all
 *   have timeouts, and the retry budget (`socket-recovery.ts`) is finite —
 *   a revoked or misconfigured socket stops instead of hammering the radio;
 * - **honest status**: `deriveCrewTrackingStatus` separates "the device has a
 *   fix" from "the server acknowledged it", so no surface can claim the school
 *   sees the bus on local GPS alone.
 *
 * What it cannot do (OS limits, stated plainly): after a **force-stop** (or the
 * OS killing the process under memory pressure on a restricted battery profile)
 * nothing in JS runs at all, so no recovery is possible until the crew member
 * opens the app again. Background execution is only guaranteed while Android
 * keeps the foreground service alive and iOS keeps the `location` background
 * mode active.
 */

/** OS background-location task name (unchanged — an existing install keeps it). */
export const CREW_LOCATION_TASK = 'school-bus-crew-location';

const WATCH_INTERVAL_MS = 4_000; // server throttle floor is 2500 ms
const WATCH_DISTANCE_METERS = 10;

/** Throttle UI re-renders from GPS: only publish lastFix when moved >10m or 10s elapsed (3E speed). */
const PUBLISH_DISTANCE_THRESHOLD_M = 10;
const PUBLISH_TIME_THRESHOLD_MS = 10_000;
let lastPublishedFix: { latitude: number; longitude: number; recordedMs: number } | null = null;

function shouldPublishFix(latitude: number, longitude: number, recordedMs: number): boolean {
  if (!lastPublishedFix) return true;
  const timeDelta = recordedMs - lastPublishedFix.recordedMs;
  if (timeDelta >= PUBLISH_TIME_THRESHOLD_MS) return true;
  // Haversine distance (inline to avoid extra import cycle)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(latitude - lastPublishedFix.latitude);
  const dLon = toRad(longitude - lastPublishedFix.longitude);
  const lat1 = toRad(lastPublishedFix.latitude);
  const lat2 = toRad(latitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const dist = 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
  return dist >= PUBLISH_DISTANCE_THRESHOLD_M;
}
/**
 * Every wait in the recovery path is bounded, so a background execution can
 * never hang open. The production values are the defaults; the object exists so
 * the simulation can shrink them (a test that waits 6 s per scenario is a test
 * nobody runs) without changing the behaviour under test.
 */
const DEFAULT_TIMEOUTS = {
  /** Waiting for a socket `connect` during recovery. */
  connect: 6_000,
  /** Waiting for one `trip:location:update` ack. */
  ack: 5_000,
  /** Waiting for the eligibility re-check (`GET /trips/:id`). */
  eligibility: 6_000,
  /** Waiting for the session refresh inside a headless execution. */
  session: 8_000,
} as const;

type TrackingTimeouts = { -readonly [K in keyof typeof DEFAULT_TIMEOUTS]: number };

const timeouts: TrackingTimeouts = { ...DEFAULT_TIMEOUTS };

/** Test seam: shrinks the bounded waits. Production never calls this. */
export function __setTrackingTimeoutsForTests(overrides: Partial<TrackingTimeouts> | null): void {
  Object.assign(timeouts, DEFAULT_TIMEOUTS, overrides ?? {});
}

/** Per-trip GPS acceptance rule — mirrors the server's tracking-active check. */
export function isTripStatusShareable(status: string | null | undefined): boolean {
  return status === TripStatus.BOARDING || status === TripStatus.IN_PROGRESS;
}

export interface CrewLocationStats {
  activeTripId: string | null;
  /** Fixes the server acknowledged (`accepted`, including `stale` accepts). */
  emittedCount: number;
  /** Fixes the client dropped (malformed device reading). */
  invalidCount: number;
  /** Fixes that could not be sent because the socket was not connected. */
  disconnectedCount: number;
  /** Fixes the server rejected (ack status `rejected`). */
  rejectedCount: number;
  /** Fixes rate-limited by the server (`throttled`) — dropped, not retried. */
  throttledCount: number;
  /** Fixes dropped because no session could be recovered for this execution. */
  unauthenticatedCount: number;
  /** Held fixes re-sent after a reconnect. */
  retriedCount: number;
  /** Held fixes discarded for exceeding the age limit (never replayed). */
  expiredCount: number;
  /** Held fixes discarded (other trip / replaced by a newer fix). */
  supersededCount: number;
  lastReason: string | null;
  /** Server receipt time of the newest acknowledged fix. */
  lastAckAt: string | null;
  /**
   * Device time of the newest fix this phone produced (local only).
   *
   * `heading` and `speed` are the same normalised readings that went into the
   * payload (speed in km/h; an unavailable heading already omitted at the
   * source). They exist so the Driver Trip map can point its marker along the
   * direction of travel without a second GPS watcher — see
   * `features/crew/crew-map-presentation.ts`. Nothing about delivery reads them.
   */
  lastFix: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    recorded_at: string;
    heading: number | null;
    speed: number | null;
  } | null;
}

const initialStats: CrewLocationStats = {
  activeTripId: null,
  emittedCount: 0,
  invalidCount: 0,
  disconnectedCount: 0,
  rejectedCount: 0,
  throttledCount: 0,
  unauthenticatedCount: 0,
  retriedCount: 0,
  expiredCount: 0,
  supersededCount: 0,
  lastReason: null,
  lastAckAt: null,
  lastFix: null,
};

export interface CrewTrackingRecoveryState {
  /** Attempts used in the current bounded budget. */
  attempts: number;
  exhausted: boolean;
  inFlight: boolean;
  lastDisconnectClass: SocketDisconnectClass | null;
  lastReason: string | null;
}

export interface CrewTrackingState {
  tripId: string | null;
  userId: string | null;
  schoolId: string | null;
  /** A foreground `watchPositionAsync` subscription is live. */
  foregroundActive: boolean;
  /** The OS background-location task is started. */
  backgroundActive: boolean;
  /** The crew member explicitly opted in to background tracking. */
  backgroundConsent: boolean;
  connection: TrackingConnectionState;
  foregroundPermission: PermissionState;
  backgroundPermission: PermissionState;
  servicesEnabled: boolean | null;
  /**
   * Why the OS background-location task cannot run on this runtime —
   * `'expo-go'` (fixable: use a development build), `'platform'` (nothing the
   * user can do), or `null` when background location is available. Set by the
   * permission read and hydration, which skip the SDK call when it is set.
   */
  backgroundUnavailableReason: 'expo-go' | 'platform' | null;
  accuracy: LocationAccuracyAuthorization;
  busy: boolean;
  message: string | null;
  /** When the current `message` was set (`null` while there is no message). */
  messageAt: string | null;
  /** Diagnostics: why tracking last stopped (`null` while it is running). */
  lastStopReason: string | null;
  /** The server trip status recorded with a `trip-not-eligible` stop, if any. */
  lastStopTripStatus: string | null;
  stats: CrewLocationStats;
  recovery: CrewTrackingRecoveryState;
}

const initialState: CrewTrackingState = {
  tripId: null,
  userId: null,
  schoolId: null,
  foregroundActive: false,
  backgroundActive: false,
  backgroundConsent: false,
  connection: 'idle',
  foregroundPermission: 'undetermined',
  backgroundPermission: 'undetermined',
  servicesEnabled: null,
  backgroundUnavailableReason: null,
  accuracy: 'unknown',
  busy: false,
  message: null,
  messageAt: null,
  lastStopReason: null,
  lastStopTripStatus: null,
  stats: { ...initialStats },
  recovery: {
    attempts: 0,
    exhausted: false,
    inFlight: false,
    lastDisconnectClass: null,
    lastReason: null,
  },
};

let state: CrewTrackingState = { ...initialState };
let pending: PendingFixState = { ...initialPendingFixState };

/**
 * The pending slot's counters, as seen at the last stats sync.
 *
 * Stats are patched with the **delta** since that sync, never with the slot's
 * own totals: overwriting them wiped counts recorded elsewhere in the same
 * session (a headless batch's superseded fixes, for example), which made the
 * crew counters lie downwards. Deltas keep every counter monotonic.
 */
let pendingSync = { expired: 0, older: 0, trip: 0, retried: 0 };

function syncPendingCounters(extra?: Partial<CrewLocationStats>): void {
  const expiredDelta = pending.expiredCount - pendingSync.expired;
  const supersededDelta =
    pending.discardedOlderCount + pending.discardedTripCount - pendingSync.older - pendingSync.trip;
  const retriedDelta = pending.retriedCount - pendingSync.retried;
  pendingSync = {
    expired: pending.expiredCount,
    older: pending.discardedOlderCount,
    trip: pending.discardedTripCount,
    retried: pending.retriedCount,
  };
  patchStats({
    expiredCount: state.stats.expiredCount + expiredDelta,
    supersededCount: state.stats.supersededCount + supersededDelta,
    retriedCount: state.stats.retriedCount + retriedDelta,
    ...extra,
  });
}

/** Drops the held fix and re-baselines its counters (stop, logout, trip switch). */
function resetPendingFix(): void {
  pending = { ...initialPendingFixState };
  pendingSync = { expired: 0, older: 0, trip: 0, retried: 0 };
}

/** Bumped on stop/logout/trip change: late async completions become no-ops. */
let epoch = 0;
let watch: Location.LocationSubscription | null = null;
let socketListenersAttached = false;
let lastRevokedReason: string | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryInFlight: Promise<void> | null = null;
let hydrateAttempted = false;
const policy = createRecoveryPolicy();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * True when every key of `next` already holds the same value (`Object.is`) in
 * `current` — i.e. applying the patch would change nothing.
 *
 * A no-op patch must **not** allocate a new state object or notify subscribers.
 * Every subscribed screen re-renders on `publish()` (`setSnapshot` with a new
 * reference), and a screen whose effect re-reads the OS permissions on render
 * (`GpsPermissionRecovery` → `refreshCrewPermissions`) turned that into an
 * infinite render loop ("Maximum update depth exceeded"): identical permission
 * values were published as a change, forever. Publishing only real changes
 * closes that loop at the source, independently of how any screen is wired.
 */
function isNoopPatch<T extends object>(current: T, next: Partial<T>): boolean {
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (!Object.is(current[key], next[key])) {
      return false;
    }
  }
  return true;
}

function patch(next: Partial<CrewTrackingState>): void {
  if (isNoopPatch(state, next)) {
    return;
  }
  // Timestamp a message the moment it becomes visible (the diagnostics
  // readout shows *when* the last error happened); a cleared message is
  // always "none right now".
  const messageAt =
    next.message !== undefined ? (next.message ? new Date().toISOString() : null) : state.messageAt;
  state = { ...state, ...next, messageAt };
  publish();
}

function patchStats(next: Partial<CrewLocationStats>): void {
  if (isNoopPatch(state.stats, next)) {
    return;
  }
  state = { ...state, stats: { ...state.stats, ...next } };
  publish();
}

function patchRecovery(next: Partial<CrewTrackingRecoveryState>): void {
  if (isNoopPatch(state.recovery, next)) {
    return;
  }
  state = { ...state, recovery: { ...state.recovery, ...next } };
  publish();
}

/** Subscribes to lifecycle changes (screens, panels, the background task). */
export function subscribeCrewTracking(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current lifecycle snapshot (immutable between publishes). */
export function getCrewTrackingState(): CrewTrackingState {
  return state;
}

/** Stats view — the counters the Help screen reads out with support. */
export function getCrewLocationStats(): CrewLocationStats {
  return state.stats;
}

/** Same listener set as {@link subscribeCrewTracking} (kept for the panels). */
export function subscribeCrewLocationStats(listener: () => void): () => void {
  return subscribeCrewTracking(listener);
}

/** Derives the honest driver status for the current instant (`now` ticks). */
export function getCrewTrackingStatus(now = Date.now()): CrewTrackingStatusResult {
  return deriveCrewTrackingStatus({
    foregroundActive: state.foregroundActive,
    backgroundActive: state.backgroundActive,
    foregroundPermission: state.foregroundPermission,
    servicesEnabled: state.servicesEnabled,
    connection: state.connection,
    lastLocalFixAt: state.stats.lastFix?.recorded_at ?? null,
    lastServerAckAt: state.stats.lastAckAt,
    now,
  });
}

/** The permission issue to surface (or `none`), given the current consent. */
export function getCrewGpsIssue(backgroundRequired = state.backgroundConsent): GpsIssue {
  return evaluateGpsPermissions({
    servicesEnabled: state.servicesEnabled,
    foreground: permissionSnapshotOf(state.foregroundPermission),
    background: permissionSnapshotOf(state.backgroundPermission),
    backgroundRequired,
  }).issue;
}

function permissionSnapshotOf(
  mapped: PermissionState,
): { granted: boolean; canAskAgain: boolean } | null {
  if (mapped === 'unavailable') {
    return null;
  }
  return { granted: mapped === 'granted', canAskAgain: mapped !== 'denied' };
}

// ── Permissions ────────────────────────────────────────────────────────────

/**
 * Reads the real OS permission/service state into the lifecycle.
 *
 * Called on start, on hydrate and whenever the app returns from OS settings —
 * a grant that happened in Settings must be observed, and a revocation must be
 * reported instead of silently producing no fixes.
 *
 * Safe to call from a render-driven effect: when the OS reports the same
 * values as before, nothing is published (see `patch`), so subscribers are not
 * re-rendered for a refresh that changed nothing.
 */
export async function refreshCrewPermissions(): Promise<{
  foregroundPermission: PermissionState;
  backgroundPermission: PermissionState;
  servicesEnabled: boolean | null;
  accuracy: LocationAccuracyAuthorization;
}> {
  let servicesEnabled: boolean | null = null;
  try {
    servicesEnabled = await Location.hasServicesEnabledAsync();
  } catch {
    servicesEnabled = null;
  }

  let foreground: Location.LocationPermissionResponse | null = null;
  try {
    foreground = await Location.getForegroundPermissionsAsync();
  } catch {
    foreground = null;
  }

  // The OS background-location task cannot exist on every runtime (Expo Go).
  // There, calling `getBackgroundPermissionsAsync()` is a LogBox warning at
  // best and a confusing error at worst — so the read itself is skipped, the
  // mapped state comes out `unavailable`, and *why* is carried on the state
  // (`backgroundUnavailableReason`) for the UI to say specifically.
  const backgroundUnavailableReason = backgroundUnavailableReasonFor(getRuntime());
  let background: Location.LocationPermissionResponse | null = null;
  if (backgroundUnavailableReason === null) {
    try {
      background = await Location.getBackgroundPermissionsAsync();
    } catch {
      background = null;
    }
  }

  const foregroundPermission = mapPermissionState(foreground);
  const backgroundPermission = mapPermissionState(background);
  const accuracy = locationAccuracyAuthorization(foreground);

  patch({
    foregroundPermission,
    backgroundPermission,
    servicesEnabled,
    accuracy,
    backgroundUnavailableReason,
  });
  return { foregroundPermission, backgroundPermission, servicesEnabled, accuracy };
}

// ── Context persistence ────────────────────────────────────────────────────

async function persistContext(): Promise<void> {
  const { tripId, userId, schoolId } = state;
  if (!tripId || !userId) {
    return;
  }
  try {
    await AsyncStorage.setItem(
      CREW_TRACKING_CONTEXT_KEY,
      serializeCrewTrackingContext(
        createCrewTrackingContext({ userId, schoolId, tripId, now: Date.now() }),
      ),
    );
  } catch {
    // Storage unavailable: the headless task simply cannot resume this run.
    // Nothing is guessed and no fix is sent for an unverified trip.
  }
}

async function clearPersistedContext(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CREW_TRACKING_CONTEXT_KEY);
    // The pre-patch key held a bare trip id with no owner; drop it so an old
    // install can never resume another account's trip.
    await AsyncStorage.removeItem(LEGACY_CREW_ACTIVE_TRIP_KEY);
  } catch {
    // Best effort: the restore decision refuses a context it cannot verify.
  }
}

// ── Socket wiring ──────────────────────────────────────────────────────────

function attachSocketListeners(): void {
  if (socketListenersAttached) {
    return;
  }
  const socket = getLiveTrackingSocket() as unknown as {
    connected: boolean;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
  };

  socket.on('connect', () => {
    lastRevokedReason = null;
    policy.reset();
    patch({ connection: 'connected' });
    patchRecovery({ attempts: 0, exhausted: false, lastReason: null });
    void (async () => {
      await rejoinTripRoom();
      await flushPendingFix();
    })();
  });

  socket.on(SESSION_REVOKED_EVENT, (...args: unknown[]) => {
    const payload = args[0] as { reason?: unknown } | null;
    lastRevokedReason = typeof payload?.reason === 'string' ? payload.reason : null;
  });

  socket.on('disconnect', (...args: unknown[]) => {
    const reason = typeof args[0] === 'string' ? args[0] : null;
    const kind = classifySocketDisconnect({ reason, revokedReason: lastRevokedReason });
    patchRecovery({ lastDisconnectClass: kind, lastReason: reason });

    if (kind === 'client-stop') {
      return;
    }
    if (kind === 'auth-revoked') {
      // Tenant/user deactivated: permanent. Stop retrying and stop tracking —
      // the server would refuse every fix anyway.
      patch({ connection: 'revoked', message: t('gps.message.revoked') });
      void stopCrewTracking('revoked', { clearMessage: false });
      return;
    }
    patch({
      connection: state.foregroundActive || state.backgroundActive ? 'reconnecting' : 'idle',
    });
    scheduleRecovery(
      kind === 'auth-expired' ? 'auth-expired' : `disconnect:${reason ?? 'unknown'}`,
    );
  });

  socket.on('connect_error', (...args: unknown[]) => {
    const raw = args[0];
    const message = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : null;
    patchRecovery({ lastReason: message });
  });

  socketListenersAttached = true;
}

/**
 * Re-enters the trip room after a reconnect.
 *
 * Room membership never survives a disconnect (the gateway re-authorizes every
 * join), so a socket that came back is a stranger until it joins again. The
 * server re-checks authorization on each join — this never widens access.
 */
async function rejoinTripRoom(): Promise<void> {
  const tripId = state.tripId;
  if (!tripId) {
    return;
  }
  const socket = getLiveTrackingSocket() as unknown as {
    connected: boolean;
    emit(event: string, payload: unknown, ack?: (value: unknown) => void): unknown;
  };
  if (!socket.connected) {
    return;
  }
  await emitWithAckBound<unknown>(
    (ack) => socket.emit(LIVE_TRACKING_EVENTS.join, { trip_id: tripId }, ack),
    timeouts.ack,
  );
}

// ── Recovery controller ────────────────────────────────────────────────────

function clearRecoveryTimer(): void {
  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

/**
 * Schedules the next bounded recovery attempt.
 *
 * No-ops when tracking is stopped, when an attempt is already pending or in
 * flight, and — importantly — when the budget is exhausted: `gave-up` is a real
 * state the UI shows, and only a new trigger (a fresh fix, a trip start, an
 * explicit Retry, or the next headless execution) resets it.
 */
function scheduleRecovery(trigger: string): void {
  if (!state.tripId || (!state.foregroundActive && !state.backgroundActive)) {
    return;
  }
  if (state.connection === 'revoked' || recoveryTimer || recoveryInFlight) {
    return;
  }
  const next = policy.next();
  if (!next) {
    patch({ connection: 'gave-up' });
    patchRecovery({ exhausted: true, lastReason: trigger });
    return;
  }
  patch({ connection: 'reconnecting' });
  patchRecovery({ attempts: next.attempt, exhausted: false, lastReason: trigger });
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    void runRecovery(trigger);
  }, next.delayMs);
}

/** One bounded recovery pass: session → socket → eligibility → pending fix. */
async function runRecovery(trigger: string): Promise<void> {
  if (recoveryInFlight) {
    return recoveryInFlight;
  }
  const startedIn = epoch;
  const run = (async (): Promise<void> => {
    patchRecovery({ inFlight: true });
    try {
      await recoverConnectivity(startedIn, trigger);
    } finally {
      patchRecovery({ inFlight: false });
    }
  })();
  recoveryInFlight = run;
  try {
    await run;
  } finally {
    if (recoveryInFlight === run) {
      recoveryInFlight = null;
    }
  }
}

async function recoverConnectivity(startedIn: number, trigger: string): Promise<boolean> {
  if (epoch !== startedIn || !state.tripId) {
    return false;
  }

  // 1. Session first: connecting without a token only produces a refused
  //    handshake and a socket that can never deliver.
  if (!getAccessToken()) {
    const session = await recoverSession({ timeoutMs: timeouts.session });
    if (epoch !== startedIn || !state.tripId) {
      return false;
    }
    if (session.status !== 'authenticated') {
      patchRecovery({ lastReason: `session:${session.reason ?? session.status}` });
      scheduleRecovery(trigger);
      return false;
    }
    if (session.user) {
      // Ownership re-check: a session for a different account than the one the
      // context was created for must never deliver that trip's fixes.
      if (state.userId && session.user.id !== state.userId) {
        await stopCrewTracking('account-changed');
        return false;
      }
      patch({ userId: session.user.id, schoolId: session.user.school_id });
    }
  }

  attachSocketListeners();

  // 2. Connectivity, bounded.
  const socket = getLiveTrackingSocket();
  if (!socket.connected) {
    patch({ connection: 'connecting' });
    const connectRequested = connectAuthenticatedSocketGuarded();
    if (!connectRequested) {
      patchRecovery({ lastReason: 'no-token' });
      scheduleRecovery(trigger);
      return false;
    }
    const waited = await connectSocketWithBound(socket as never, {
      timeoutMs: timeouts.connect,
    });
    if (epoch !== startedIn || !state.tripId) {
      return false;
    }
    if (!waited.connected) {
      patch({ connection: 'reconnecting' });
      patchRecovery({ lastReason: waited.error ?? 'connect-timeout' });
      scheduleRecovery(trigger);
      return false;
    }
  }

  patch({ connection: 'connected' });
  policy.reset();
  patchRecovery({ attempts: 0, exhausted: false });

  // 3. Re-check active-trip eligibility with the server (authorization is
  //    re-verified there; a closed or foreign trip stops tracking for good).
  const eligible = await verifyTripEligibility(startedIn, state.tripId);
  if (epoch !== startedIn || !state.tripId) {
    return false;
  }
  if (eligible.verdict === 'refused') {
    await stopCrewTracking('trip-not-eligible', { tripStatus: eligible.tripStatus });
    return false;
  }

  // 4. Rooms and the held fix.
  await rejoinTripRoom();
  await flushPendingFix();
  return epoch === startedIn && !!state.tripId;
}

/** `connectAuthenticatedSocket` without importing a cycle (session guard). */
function connectAuthenticatedSocketGuarded(): boolean {
  if (!getAccessToken()) {
    return false;
  }
  const socket = getLiveTrackingSocket() as unknown as {
    connected: boolean;
    connect(): unknown;
  };
  if (!socket.connected) {
    socket.connect();
  }
  return true;
}

/**
 * Asks the server whether this trip still accepts GPS.
 *
 * `unverified` (network/API failure) deliberately does **not** stop tracking:
 * the socket handshake and every `trip:location:update` are authorized
 * server-side anyway, so a failed extra GET must not kill a working stream.
 *
 * `tripStatus` carries the server's status when the verdict is based on one,
 * so a `refused` stop can be diagnosed with *which* status ended sharing.
 */
async function verifyTripEligibility(
  startedIn: number,
  tripId: string,
): Promise<{ verdict: 'eligible' | 'refused' | 'unverified'; tripStatus: string | null }> {
  try {
    const envelope = await withBound(apiClient.getTrip(tripId), timeouts.eligibility);
    if (epoch !== startedIn) {
      return { verdict: 'unverified', tripStatus: null };
    }
    if (!envelope) {
      return { verdict: 'unverified', tripStatus: null };
    }
    const tripStatus = typeof envelope.data?.status === 'string' ? envelope.data.status : null;
    if (envelope.success === false) {
      // The server refused the read: not found, forbidden, or a closed trip.
      // Every one of them means this account may not keep sending fixes.
      return { verdict: 'refused', tripStatus };
    }
    return { verdict: isTripStatusShareable(tripStatus) ? 'eligible' : 'refused', tripStatus };
  } catch {
    return { verdict: 'unverified', tripStatus: null };
  }
}

async function withBound<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// ── Fix delivery ───────────────────────────────────────────────────────────

export type PushFixResult = 'emitted' | 'no-trip' | 'invalid' | 'not-connected' | 'superseded';

/**
 * Handles one native device fix (foreground watch or background task).
 *
 * Synchronous by design so a location callback never awaits: when the socket is
 * connected the fix is emitted immediately; otherwise it is offered to the
 * bounded pending slot and a recovery run is scheduled. The fix's own
 * `recorded_at` and a per-fix idempotency key are preserved for any retry.
 */
export function deliverCrewDeviceFix(fix: DeviceLocationFix): PushFixResult {
  const tripId = state.tripId;
  if (!tripId) {
    return 'no-trip';
  }

  const idempotencyKey = generateIdempotencyKey();
  const payload: TripLocationUpdatePayload | null = buildLocationPayload(
    tripId,
    fix,
    idempotencyKey,
  );
  if (!payload) {
    patchStats({ invalidCount: state.stats.invalidCount + 1 });
    return 'invalid';
  }

  const recordedMs = new Date(payload.recorded_at).getTime();
  if (shouldPublishFix(payload.latitude, payload.longitude, recordedMs)) {
    lastPublishedFix = {
      latitude: payload.latitude,
      longitude: payload.longitude,
      recordedMs,
    };
    patchStats({
      lastFix: {
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy: payload.accuracy ?? null,
        recorded_at: payload.recorded_at,
        // `payload.heading` is absent when the device had no course (the source
        // fix in `lib/geo.ts` omits it) — held as `null`, never as 0.
        heading: payload.heading ?? null,
        speed: payload.speed ?? null,
      },
    });
  }

  const socket = getLiveTrackingSocket() as unknown as { connected: boolean };
  if (!socket.connected || !getAccessToken()) {
    // Bounded, latest-only recovery slot — never an unbounded queue, and never
    // a burst of old live points on reconnect.
    const offered = offerPendingFix(pending, { tripId, payload, idempotencyKey, now: Date.now() });
    pending = offered.state;
    syncPendingCounters({ disconnectedCount: state.stats.disconnectedCount + 1 });
    scheduleRecovery(socket.connected ? 'no-token' : 'not-connected');
    return 'not-connected';
  }

  void sendPayload(payload, idempotencyKey);
  return 'emitted';
}

/** Emits one payload and applies the server's ack to the shared state. */
async function sendPayload(
  payload: TripLocationUpdatePayload,
  idempotencyKey: string,
): Promise<'accepted' | 'rejected' | 'no-ack'> {
  const socket = getLiveTrackingSocket() as unknown as {
    connected: boolean;
    emit(event: string, body: unknown, ack: (value: TripLocationUpdateAck) => void): unknown;
  };
  const startedIn = epoch;
  const { ack, timedOut } = await emitWithAckBound<TripLocationUpdateAck>(
    (callback) => socket.emit(LIVE_TRACKING_EVENTS.locationUpdate, payload, callback),
    timeouts.ack,
  );

  if (epoch !== startedIn) {
    // Stopped / logged out while the ack was in flight: never resurrect.
    return 'no-ack';
  }

  if (timedOut || !ack) {
    // The held entry (if this was a retry) stays for the next bounded attempt;
    // a live fix that never got an ack is offered to the slot now.
    if (!pending.fix || pending.fix.idempotencyKey !== idempotencyKey) {
      const offered = offerPendingFix(pending, {
        tripId: payload.trip_id,
        payload,
        idempotencyKey,
        now: Date.now(),
      });
      pending = offered.state;
      syncPendingCounters({ disconnectedCount: state.stats.disconnectedCount + 1 });
    }
    patch({ connection: socket.connected ? state.connection : 'reconnecting' });
    scheduleRecovery('ack-timeout');
    return 'no-ack';
  }

  const kind = classifyLocationAck(ack);
  if (kind === 'accepted' || kind === 'accepted-stale') {
    pending = acknowledgePendingFix(pending, idempotencyKey);
    policy.reset();
    patchRecovery({ attempts: 0, exhausted: false });
    patchStats({
      emittedCount: state.stats.emittedCount + 1,
      lastAckAt: ack.received_at ?? new Date().toISOString(),
      lastReason: null,
      retriedCount: pending.retriedCount,
    });
    if (state.connection !== 'connected') {
      patch({ connection: 'connected' });
    }
    return 'accepted';
  }

  if (kind === 'throttled') {
    // Server-side rate limit: this fix is redundant, do not retry it.
    patchStats({
      throttledCount: state.stats.throttledCount + 1,
      lastReason: ack.reason ?? 'throttled',
    });
    return 'rejected';
  }

  if (kind === 'session') {
    patchStats({ rejectedCount: state.stats.rejectedCount + 1, lastReason: ack.reason ?? null });
    scheduleRecovery('ack-unauthenticated');
    return 'rejected';
  }

  if (isPermanentLocationRejection(kind)) {
    patchStats({ rejectedCount: state.stats.rejectedCount + 1, lastReason: ack.reason ?? null });
    await stopCrewTracking('rejected-permanent');
    return 'rejected';
  }

  patchStats({
    invalidCount: state.stats.invalidCount + 1,
    lastReason: ack.reason ?? 'rejected',
  });
  return 'rejected';
}

/**
 * Re-sends the single held fix after a reconnect, inside its age and attempt
 * bounds. Expired/exhausted entries are counted and dropped — never replayed as
 * a current position.
 */
async function flushPendingFix(): Promise<void> {
  const tripId = state.tripId;
  const socket = getLiveTrackingSocket() as unknown as { connected: boolean };
  if (!tripId || !socket.connected) {
    return;
  }
  const take = takePendingFix(pending, { tripId, now: Date.now() });
  pending = take.state;
  syncPendingCounters();
  if (!take.fix) {
    return;
  }
  await sendPayload(take.fix.payload, take.fix.idempotencyKey);
}

// ── Watcher / background task ──────────────────────────────────────────────

async function ensureForegroundWatch(startedIn: number): Promise<void> {
  if (watch) {
    return; // one watcher for the whole app, however many screens are mounted
  }
  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: WATCH_INTERVAL_MS,
      distanceInterval: WATCH_DISTANCE_METERS,
    },
    (fix) => {
      deliverCrewDeviceFix(fix as DeviceLocationFix);
    },
  );
  if (epoch !== startedIn) {
    // Stopped while the watch was being created: remove it, do not adopt it.
    try {
      subscription.remove();
    } catch {
      // Already released by the OS.
    }
    return;
  }
  watch = subscription;
  patch({ foregroundActive: true });
}

async function clearForegroundWatch(): Promise<void> {
  const existing = watch;
  watch = null;
  if (existing) {
    try {
      await existing.remove();
    } catch {
      // Already removed by the OS.
    }
  }
  if (state.foregroundActive) {
    patch({ foregroundActive: false });
  }
}

/** Notification copy of the Android foreground service (localised at call time). */
function foregroundServiceOptions(): Location.LocationTaskOptions['foregroundService'] {
  return {
    notificationTitle: t('gps.service.title'),
    // Honest wording: the service shares this device's GPS while the trip is
    // active — it cannot promise the school has received anything.
    notificationBody: t('gps.service.body'),
    notificationColor: '#f59e0b',
    /**
     * `false` is the deliberate choice here (verified against the installed
     * expo-location 57 Android source, `LocationTaskService.onTaskRemoved`:
     * `if (mKillService) { stop() }`). With `true`, swiping the app away from
     * Recents stops the foreground service and the school silently loses the
     * bus mid-run; with `false` the service survives the swipe and keeps
     * delivering until the trip ends, the crew member stops sharing, or the OS
     * force-stops the process — which no app can recover from.
     */
    killServiceOnDestroy: false,
  };
}

/**
 * Starts (or stops) the OS background-location task.
 *
 * Requires the crew member's explicit consent (`setBackgroundConsent`) *and* a
 * granted background permission; a foreground-only grant never enables it.
 */
export async function setBackgroundTrackingEnabled(
  enabled: boolean,
): Promise<{ ok: boolean; message: string | null }> {
  const startedIn = epoch;
  const backgroundUnavailableReason = backgroundUnavailableReasonFor(getRuntime());
  patch({ busy: true, message: null, backgroundUnavailableReason });
  try {
    if (!enabled) {
      // Where the task cannot exist there is nothing to stop — the SDK call
      // would only warn.
      if (backgroundUnavailableReason === null) {
        try {
          await Location.stopLocationUpdatesAsync(CREW_LOCATION_TASK);
        } catch {
          // Never started, or the OS already stopped it.
        }
      }
      patch({ backgroundActive: false, backgroundConsent: false });
      return { ok: true, message: null };
    }

    if (backgroundUnavailableReason !== null) {
      // Say specifically what is missing instead of letting the SDK fail in a
      // way the driver cannot act on (and never attempt the task start).
      const message =
        backgroundUnavailableReason === 'expo-go'
          ? t('gps.message.backgroundNeedsDevBuild')
          : t('gps.message.backgroundUnavailable');
      patch({ message });
      return { ok: false, message };
    }

    const permissions = await refreshCrewPermissions();
    if (permissions.backgroundPermission === 'unavailable') {
      const message = t('gps.message.backgroundUnavailable');
      patch({ message });
      return { ok: false, message };
    }
    if (permissions.backgroundPermission !== 'granted') {
      const message = t('gps.message.backgroundDenied');
      patch({ message });
      return { ok: false, message };
    }
    if (!state.tripId) {
      const message = t('gps.message.backgroundNeedsTrip');
      patch({ message });
      return { ok: false, message };
    }

    await persistContext();
    await Location.startLocationUpdatesAsync(CREW_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: WATCH_INTERVAL_MS,
      distanceInterval: WATCH_DISTANCE_METERS,
      deferredUpdatesInterval: 15_000,
      deferredUpdatesDistance: 25,
      // Keep the OS from suspending updates while the bus waits at a stop.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: foregroundServiceOptions(),
    });
    if (epoch !== startedIn) {
      return { ok: false, message: null };
    }
    patch({ backgroundActive: true, backgroundConsent: true });
    return { ok: true, message: null };
  } catch (error) {
    const message = getApiErrorMessage(error, t('gps.message.backgroundFailed'));
    patch({ message });
    return { ok: false, message };
  } finally {
    patch({ busy: false });
  }
}

export interface StartCrewTrackingInput {
  tripId: string;
  userId: string;
  schoolId: string | null;
}

/**
 * Starts foreground GPS sharing for one trip (explicit user action).
 *
 * Idempotent: starting twice — from two screens, or twice from one — keeps the
 * single watcher and never duplicates it. A different trip switches the context
 * (dropping the previous trip's pending fix, which must never be replayed).
 */
export async function startCrewTracking(
  input: StartCrewTrackingInput,
): Promise<{ ok: boolean; message: string | null }> {
  const startedIn = epoch;
  patch({ busy: true, message: null });
  try {
    const permissions = await refreshCrewPermissions();
    if (permissions.servicesEnabled === false) {
      const message = t('gps.message.servicesOff');
      patch({ message });
      return { ok: false, message };
    }
    if (permissions.foregroundPermission !== 'granted') {
      const requested = await Location.requestForegroundPermissionsAsync().catch(() => null);
      const mapped = mapPermissionState(requested);
      patch({
        foregroundPermission: mapped,
        accuracy: locationAccuracyAuthorization(requested),
      });
      if (mapped !== 'granted') {
        const message = t('gps.message.permissionRequired');
        patch({ message });
        return { ok: false, message };
      }
    }

    if (state.tripId && state.tripId !== input.tripId) {
      // Trip switch: the previous trip's held fix belongs to the previous trip
      // and its counters must not be reported against the new one.
      resetPendingFix();
      policy.reset();
      patch({
        stats: { ...initialStats, activeTripId: input.tripId },
        message: null,
      });
    }

    patch({
      tripId: input.tripId,
      userId: input.userId,
      schoolId: input.schoolId,
      stats: {
        ...state.stats,
        activeTripId: input.tripId,
      },
    });
    await persistContext();

    attachSocketListeners();
    if (state.connection === 'idle' || state.connection === 'gave-up') {
      patch({ connection: getAccessToken() ? 'connecting' : 'reconnecting' });
      policy.reset();
      patchRecovery({ attempts: 0, exhausted: false });
    }

    await ensureForegroundWatch(startedIn);
    if (epoch !== startedIn) {
      return { ok: false, message: null };
    }

    // Connectivity + eligibility run in the background: the driver's action
    // resolves as soon as the device is actually producing fixes, and the
    // status line tells the truth about delivery until the first ack lands.
    void runRecovery('start');
    return { ok: true, message: null };
  } catch (error) {
    const message = getApiErrorMessage(error, t('gps.message.startFailed'));
    patch({ message });
    return { ok: false, message };
  } finally {
    patch({ busy: false });
  }
}

/**
 * Explicit user retry (the strip's Retry button, the Help panel's re-check).
 *
 * Resets the bounded budget and runs one recovery pass immediately: a driver
 * who sees "Reconnecting" must always have a way to force the attempt instead
 * of waiting for the next scheduled one. It never widens the budget — a
 * revoked session or a closed trip still ends in `stopCrewTracking`.
 */
export async function requestCrewTrackingRecovery(): Promise<void> {
  if (!state.tripId) {
    return;
  }
  if (state.connection === 'revoked') {
    return;
  }
  clearRecoveryTimer();
  policy.reset();
  patchRecovery({ attempts: 0, exhausted: false });
  await runRecovery('manual-retry');
}

/**
 * Stops tracking and cancels every pending/in-flight recovery.
 *
 * `reason` is recorded for diagnostics; `clearMessage: false` keeps a message
 * the caller just set (e.g. the revocation notice); `tripStatus` records the
 * server trip status when the stop is a closed/foreign-trip refusal, so the
 * status line can say *which* status ended sharing.
 */
export async function stopCrewTracking(
  reason: string = 'user',
  options: { clearMessage?: boolean; tripStatus?: string | null } = {},
): Promise<void> {
  epoch += 1; // invalidates late async completions of the previous run
  clearRecoveryTimer();
  recoveryInFlight = null;
  invalidateSessionRecovery();
  policy.reset();

  await clearForegroundWatch();
  // The OS background task cannot exist on every runtime (Expo Go) — there is
  // nothing to probe or stop, and the SDK calls would only warn.
  if (backgroundUnavailableReasonFor(getRuntime()) === null) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(CREW_LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(CREW_LOCATION_TASK);
      }
    } catch {
      // Never started (or the OS already stopped it).
    }
  }
  await clearPersistedContext();

  resetPendingFix();
  lastPublishedFix = null;
  state = {
    ...initialState,
    foregroundPermission: state.foregroundPermission,
    backgroundPermission: state.backgroundPermission,
    servicesEnabled: state.servicesEnabled,
    accuracy: state.accuracy,
    connection: state.connection === 'revoked' ? 'revoked' : 'idle',
    message: options.clearMessage === false ? state.message : null,
    messageAt: options.clearMessage === false ? state.messageAt : null,
    // Diagnostics only: why tracking stopped (user, trip closed, revoked,
    // account changed, permanent server rejection). Never shown as prose.
    lastStopReason: reason,
    lastStopTripStatus: options.tripStatus ?? null,
    stats: { ...initialStats, activeTripId: null },
  };
  publish();
}

/**
 * Logout / account switch: cancels recovery, drops pending fixes, forgets the
 * persisted context and resets the lifecycle. The socket itself is disconnected
 * by `AuthProvider.clearSession` (unchanged PR #139 behaviour).
 */
export async function endCrewTrackingSession(): Promise<void> {
  hydrateAttempted = false;
  await stopCrewTracking('session-ended');
}

// ── Headless background execution ──────────────────────────────────────────

export interface HeadlessRunResult {
  /** Fixes emitted to a connected, authenticated socket. */
  delivered: number;
  /**
   * Fixes discarded for good (superseded by a newer one in the same batch,
   * expired, invalid, or refused). A fix held for the bounded retry is **not**
   * counted here — it is reported through `pending` instead, so a caller never
   * reads "held for retry" as "lost".
   */
  dropped: number;
  /** True when the newest fix was held for a bounded retry instead. */
  pending: boolean;
  session: 'present' | 'recovered' | 'anonymous' | 'timeout' | 'error';
  context: TrackingContextDecision | 'in-memory';
  eligibility: 'eligible' | 'refused' | 'unverified';
  reason: string | null;
}

/**
 * Runs one background-task execution end to end.
 *
 * This is the recovery path the OS relies on: a fresh process has an empty
 * in-memory token, no mounted screen and no socket, so the naive "restore the
 * trip id and emit" version dropped every fix. The sequence is
 * session → context ownership → eligibility → connectivity → newest fix, each
 * step bounded, and every failure reported as data (never as a silent drop).
 *
 * Only the **newest** fix of a batch is delivered: an OS batch can hold fixes
 * minutes apart, and replaying the older ones would put stale coordinates on
 * the live map (the server would also throttle/reject them).
 */
export async function runHeadlessCrewLocationTask(
  locations: DeviceLocationFix[] | undefined | null,
): Promise<HeadlessRunResult> {
  const startedIn = epoch;
  const result: HeadlessRunResult = {
    delivered: 0,
    dropped: 0,
    pending: false,
    session: 'present',
    context: 'none',
    eligibility: 'unverified',
    reason: null,
  };

  const fixes = Array.isArray(locations) ? locations.filter(Boolean) : [];
  if (fixes.length === 0) {
    result.reason = 'no-fix';
    return result;
  }

  const newest = pickNewestFix(fixes);
  result.dropped = fixes.length - 1;
  if (fixes.length > 1) {
    patchStats({ supersededCount: state.stats.supersededCount + (fixes.length - 1) });
  }

  // 1. Session (single-flight + bounded): without it nothing can be sent.
  if (!getAccessToken()) {
    const session = await recoverSession({ timeoutMs: timeouts.session });
    result.session =
      session.status === 'authenticated'
        ? session.reason === 'token-present'
          ? 'present'
          : 'recovered'
        : session.status;
    if (epoch !== startedIn) {
      result.reason = 'cancelled';
      return result;
    }
    if (session.status !== 'authenticated') {
      result.reason = `session:${session.reason ?? session.status}`;
      result.dropped += 1;
      patchStats({ unauthenticatedCount: state.stats.unauthenticatedCount + 1 });
      return result;
    }

    // 2. Context ownership — resume only this session's own trip.
    if (!state.tripId || (session.user && state.userId !== session.user.id)) {
      const restored = await restoreOwnedContext(session.user);
      result.context = restored.decision;
      if (epoch !== startedIn) {
        result.reason = 'cancelled';
        return result;
      }
      if (restored.decision !== 'resume' || !restored.tripId) {
        result.reason = `context:${restored.decision}`;
        result.dropped += 1;
        if (restored.decision === 'other-user' || restored.decision === 'other-school') {
          // A context that is not ours must not survive: drop it.
          await clearPersistedContext();
        }
        patchStats({ unauthenticatedCount: state.stats.unauthenticatedCount + 1 });
        return result;
      }
    } else {
      result.context = 'in-memory';
    }
  } else if (state.tripId) {
    result.context = 'in-memory';
  } else {
    const restored = await restoreOwnedContext(null);
    result.context = restored.decision;
    if (restored.decision !== 'resume' || !restored.tripId) {
      result.reason = `context:${restored.decision}`;
      result.dropped += 1;
      return result;
    }
  }

  if (!state.tripId) {
    result.reason = 'no-trip';
    result.dropped += 1;
    return result;
  }

  attachSocketListeners();

  // 3. Eligibility re-check (bounded, non-fatal on network failure).
  const eligible = await verifyTripEligibility(startedIn, state.tripId);
  result.eligibility = eligible.verdict;
  if (epoch !== startedIn) {
    result.reason = 'cancelled';
    return result;
  }
  if (result.eligibility === 'refused') {
    result.reason = 'trip-not-eligible';
    result.dropped += 1;
    await stopCrewTracking('headless-not-eligible', { tripStatus: eligible.tripStatus });
    return result;
  }

  // 4. Connectivity (bounded).
  const socket = getLiveTrackingSocket() as unknown as { connected: boolean };
  if (!socket.connected) {
    patch({ connection: 'connecting' });
    if (!connectAuthenticatedSocketGuarded()) {
      result.reason = 'no-token';
      if (!holdFix(newest, result)) {
        result.dropped += 1;
      }
      return result;
    }
    const waited = await connectSocketWithBound(socket as never, {
      timeoutMs: timeouts.connect,
    });
    if (epoch !== startedIn) {
      result.reason = 'cancelled';
      return result;
    }
    if (!waited.connected) {
      result.reason = waited.error ?? 'connect-timeout';
      patch({ connection: 'reconnecting' });
      if (!holdFix(newest, result)) {
        result.dropped += 1;
      }
      return result;
    }
  }

  patch({ connection: 'connected' });
  policy.reset();
  await rejoinTripRoom();

  // 5. Deliver the newest fix; on failure hold it for the bounded retry.
  const tripId = state.tripId;
  const payload = buildLocationPayload(tripId, newest, generateIdempotencyKey());
  if (!payload) {
    result.reason = 'invalid-fix';
    result.dropped += 1;
    patchStats({ invalidCount: state.stats.invalidCount + 1 });
    return result;
  }
  // Throttle UI publish from headless path too (3E speed).
  {
    const recordedMs = new Date(payload.recorded_at).getTime();
    if (shouldPublishFix(payload.latitude, payload.longitude, recordedMs)) {
      lastPublishedFix = {
        latitude: payload.latitude,
        longitude: payload.longitude,
        recordedMs,
      };
      patchStats({
        lastFix: {
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy ?? null,
          recorded_at: payload.recorded_at,
          heading: payload.heading ?? null,
          speed: payload.speed ?? null,
        },
      });
    }
  }

  const outcome = await sendPayload(payload, payload.idempotency_key ?? '');
  if (epoch !== startedIn) {
    result.reason = 'cancelled';
    return result;
  }
  if (outcome === 'accepted') {
    result.delivered += 1;
    return result;
  }
  result.reason = outcome === 'no-ack' ? 'ack-timeout' : (state.stats.lastReason ?? 'rejected');
  result.dropped += 1;
  if (outcome === 'no-ack') {
    result.pending = true;
  }
  return result;
}

function holdFix(fix: DeviceLocationFix, result: HeadlessRunResult): boolean {
  const tripId = state.tripId;
  if (!tripId) {
    return false;
  }
  const payload = buildLocationPayload(tripId, fix, generateIdempotencyKey());
  if (!payload) {
    patchStats({ invalidCount: state.stats.invalidCount + 1 });
    return false;
  }
  const offered = offerPendingFix(pending, {
    tripId,
    payload,
    idempotencyKey: payload.idempotency_key ?? '',
    now: Date.now(),
  });
  pending = offered.state;
  result.pending = offered.action === 'captured' || offered.action === 'replaced';
  syncPendingCounters({ disconnectedCount: state.stats.disconnectedCount + 1 });
  return result.pending;
}

/** Newest fix by device timestamp; ties keep the later array entry. */
function pickNewestFix(fixes: DeviceLocationFix[]): DeviceLocationFix {
  return fixes.reduce((newest, candidate) => {
    const a = new Date(newest.timestamp).getTime();
    const b = new Date(candidate.timestamp).getTime();
    return Number.isFinite(b) && (!Number.isFinite(a) || b >= a) ? candidate : newest;
  }, fixes[0]);
}

/**
 * Restores the persisted context **only** when it belongs to the recovered
 * session. `session` is `null` when an in-memory token short-circuited the
 * refresh (no identity available) — in that case nothing is resumed, because
 * ownership cannot be proven.
 */
async function restoreOwnedContext(
  session: { id: string; school_id: string | null } | null,
): Promise<{ decision: TrackingContextDecision; tripId: string | null }> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(CREW_TRACKING_CONTEXT_KEY);
  } catch {
    raw = null;
  }
  const decision = decideTrackingContextRestore({ raw, session, now: Date.now() });
  if (decision.decision !== 'resume' || !decision.context) {
    return { decision: decision.decision, tripId: null };
  }
  patch({
    tripId: decision.context.tripId,
    userId: decision.context.userId,
    schoolId: decision.context.schoolId,
    stats: { ...state.stats, activeTripId: decision.context.tripId },
  });
  return { decision: decision.decision, tripId: decision.context.tripId };
}

// ── Hydration (foreground screens) ─────────────────────────────────────────

/**
 * Reflects the real runtime state into the lifecycle once per process: OS
 * permissions, whether the background task is actually started, and — for the
 * signed-in account only — a persisted context left by a headless run.
 *
 * It never starts delivery and never resumes another user's trip.
 */
export async function hydrateCrewTracking(identity: {
  userId: string;
  schoolId: string | null;
}): Promise<void> {
  await refreshCrewPermissions();

  // The OS task state can only be read where the task can exist; in Expo Go
  // the answer is known up front and `hasStartedLocationUpdatesAsync` would
  // warn (LogBox) instead of answering.
  let backgroundActive = false;
  if (backgroundUnavailableReasonFor(getRuntime()) === null) {
    try {
      backgroundActive = await Location.hasStartedLocationUpdatesAsync(CREW_LOCATION_TASK);
    } catch {
      backgroundActive = false;
    }
  }
  patch({ backgroundActive });

  if (hydrateAttempted) {
    return;
  }
  hydrateAttempted = true;

  if (!state.tripId) {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(CREW_TRACKING_CONTEXT_KEY);
    } catch {
      raw = null;
    }
    const decision = decideTrackingContextRestore({
      raw,
      session: { id: identity.userId, school_id: identity.schoolId },
      now: Date.now(),
    });
    if (decision.decision === 'resume' && decision.context) {
      patch({
        tripId: decision.context.tripId,
        userId: decision.context.userId,
        schoolId: decision.context.schoolId,
        stats: { ...state.stats, activeTripId: decision.context.tripId },
      });
      attachSocketListeners();
      if (backgroundActive) {
        void runRecovery('hydrate');
      }
    } else if (decision.decision === 'other-user' || decision.decision === 'other-school') {
      await clearPersistedContext();
    }
  } else if (state.userId && state.userId !== identity.userId) {
    // The signed-in account changed under a live lifecycle: stop, never carry on.
    await stopCrewTracking('account-changed');
  }
}

/** Test/diagnostics seam: resets the singleton between simulation scenarios. */
export async function __resetCrewTrackingForTests(): Promise<void> {
  await clearForegroundWatch();
  clearRecoveryTimer();
  recoveryInFlight = null;
  invalidateSessionRecovery();
  policy.reset();
  resetPendingFix();
  lastPublishedFix = null;
  epoch += 1;
  hydrateAttempted = false;
  socketListenersAttached = false;
  lastRevokedReason = null;
  state = { ...initialState, stats: { ...initialStats } };
  publish();
}
