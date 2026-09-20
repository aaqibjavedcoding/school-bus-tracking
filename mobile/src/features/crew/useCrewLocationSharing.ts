import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import { t } from '../../lib/i18n.ts';
import { formatRelative } from '../../lib/format.ts';
import { API_BASE_URL } from '../../services/api.ts';
import {
  getCrewTrackingState,
  refreshCrewPermissions,
  requestCrewTrackingRecovery,
  setBackgroundTrackingEnabled,
  startCrewTracking,
  stopCrewTracking,
  subscribeCrewTracking,
  hydrateCrewTracking,
  type CrewTrackingState,
} from './tracking-lifecycle.ts';
import type { CrewLocationStats } from './tracking-lifecycle.ts';
import type { CrewTrackingStatusResult } from './tracking-status.ts';
import {
  crewTrackingStatusLine,
  crewTrackingStatusTone,
  deriveCrewTrackingStatus,
} from './tracking-status.ts';
import type {
  GpsIssue,
  LocationAccuracyAuthorization,
  PermissionState,
} from './gps-permission-state.ts';
import { evaluateGpsPermissions, mapPermissionState } from './gps-permission-state.ts';

/**
 * Crew GPS sharing (DRIVER + CONDUCTOR) — the React binding over the **one**
 * tracking lifecycle (`tracking-lifecycle.ts`).
 *
 * Before this patch each screen that called this hook owned its own watcher,
 * its own start/stop state and its own idea of "sharing": the Trip screen and
 * the Help screen could each start a `watchPositionAsync`, and a screen that
 * lost its trip could stop a stream the other one still showed as running.
 *
 * The hook now owns no location state of its own. It subscribes to the shared
 * lifecycle, forwards user actions to it, and derives the honest status line:
 *
 * - `sharing` — a foreground watch is running on this device;
 * - `backgroundActive` — the OS background task is started;
 * - `statusDetail.schoolSeesLive` — **the server acknowledged a fix inside the
 *   live window**. This, and only this, may be described as "the school can see
 *   the bus";
 * - `statusDetail.status` — `live` / `local-only` / `reconnecting` / `stale` /
 *   `permission-blocked` / `services-off` / `waiting-for-fix` / `revoked` /
 *   `stopped`.
 *
 * Mounting and unmounting screens never start or stop tracking: only an
 * explicit user action, a trip closing, or a logout does.
 */

export type { PermissionState, GpsIssue, LocationAccuracyAuthorization };
export type { CrewLocationStats };

/** The signed-in identity the lifecycle scopes the persisted context to. */
export interface CrewTrackingIdentity {
  userId: string;
  schoolId: string | null;
}

export interface CrewLocationSharing {
  foregroundPermission: PermissionState;
  backgroundPermission: PermissionState;
  /** A foreground watch is running. */
  sharing: boolean;
  /** The OS background-location task is started. */
  backgroundActive: boolean;
  /** The crew member explicitly consented to background tracking. */
  backgroundConsent: boolean;
  stats: CrewLocationStats;
  busy: boolean;
  message: string | null;
  canShare: boolean;
  /** The honest, derived status (server acknowledgement vs local fix). */
  statusDetail: CrewTrackingStatusResult;
  /** Convenience: `statusDetail.status`. */
  status: CrewTrackingStatusResult['status'];
  /** Localised status line for the compact strip. */
  statusLine: string;
  /** Badge tone that matches the status word (colour is never the only cue). */
  statusTone: ReturnType<typeof crewTrackingStatusTone>;
  /** The permission issue blocking tracking, or `none`. */
  issue: GpsIssue;
  /** OS-reported accuracy authorization (`reduced` cannot confirm a geofence). */
  accuracy: LocationAccuracyAuthorization;
  /** OS location switch state (`null` when the platform would not answer). */
  servicesEnabled: boolean | null;
  /** Diagnostics: why tracking last stopped (`null` while running). */
  lastStopReason: string | null;
  connection: CrewTrackingState['connection'];
  recovery: CrewTrackingState['recovery'];
  /**
   * The full lifecycle snapshot (stable reference between publishes).
   * The diagnostics readout on the Help screen renders rows from it — one
   * reference instead of a dozen parallel fields drifting apart.
   */
  trackingState: CrewTrackingState;
  /**
   * Starts sharing for the screen's current trip. `trip` overrides it for the
   * one case where the screen's copy is known to be stale: the driver's own
   * lifecycle tap was just confirmed by the server (`BOARDING` /
   * `IN_PROGRESS`), and sharing must start on that confirmed trip without
   * waiting for the list to reload. A non-shareable trip is refused either way.
   */
  startSharing: (trip?: TripResponse) => Promise<void>;
  stopSharing: () => Promise<void>;
  enableBackground: () => Promise<void>;
  disableBackground: () => Promise<void>;
  /** Forces one bounded recovery pass (retry button). */
  retry: () => Promise<void>;
  /**
   * Opens the OS location settings (strip repair tap: location switch off, or
   * a foreground permission that can only be granted in Settings). Never
   * starts sharing — the driver comes back and taps the strip again.
   */
  openLocationSettings: () => Promise<void>;
  /**
   * Fires the in-app foreground permission request (strip repair tap: the
   * permission was refused or never asked, and the OS will still answer).
   * A **grant** completes the start the driver already asked for (the strip
   * offered this button because a start was refused) — that is the driver's
   * explicit intent, not the auto-start that `GpsPermissionRecovery` must
   * never do. A refusal or "ask later" leaves everything exactly as it was.
   */
  requestLocationPermission: () => Promise<void>;
}

/** Trips that accept GPS fixes (mirrors the server's tracking-active rule). */
export function isTripShareable(trip: TripResponse | null | undefined): boolean {
  return trip?.status === TripStatus.BOARDING || trip?.status === TripStatus.IN_PROGRESS;
}

/** How often the status line re-evaluates so freshness ages without new data. */
const STATUS_TICK_MS = 5_000;

export function useCrewLocationSharing(
  trip: TripResponse | null,
  identity: CrewTrackingIdentity | null,
  options: { settled?: boolean } = {},
): CrewLocationSharing {
  const [snapshot, setSnapshot] = useState<CrewTrackingState>(getCrewTrackingState());
  const [tick, setTick] = useState<number>(() => Date.now());
  const tripRef = useRef<TripResponse | null>(trip);
  tripRef.current = trip;
  const identityRef = useRef<CrewTrackingIdentity | null>(identity);
  identityRef.current = identity;
  const settled = options.settled !== false;

  // One subscription for every mounted screen: the lifecycle is the owner.
  useEffect(() => subscribeCrewTracking(() => setSnapshot(getCrewTrackingState())), []);

  // Reflect the real runtime state (permissions, whether the OS task is
  // running, an owned persisted context) once the identity is known.
  useEffect(() => {
    if (!identity) {
      return;
    }
    void hydrateCrewTracking(identity);
  }, [identity?.userId, identity?.schoolId]);

  // Age the indicators even when nothing new arrives: a status that says
  // "updated just now" must become "stale" on its own.
  const active = snapshot.foregroundActive || snapshot.backgroundActive;
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = setInterval(() => setTick(Date.now()), STATUS_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  // A trip that closed (completed/cancelled) or a settled load with no trip
  // ends tracking — but an unsettled load (a screen still fetching) must not.
  //
  // The rule runs when **this screen's knowledge** changes (its load settling,
  // its trip changing status or identity) — never merely because the lifecycle
  // started. Two screens bind this hook with independent loads (Trip, Help) and
  // the tab navigator keeps both mounted, so a screen can hold a copy that is
  // older than the run: Help opened before the trip was dispatched ("no trip")
  // or before the driver's lifecycle tap ("SCHEDULED"). Reacting to the watcher
  // starting let such a stale copy tear down the run the driver had just
  // started on the other screen. A screen only gets a vote when it learns
  // something new, and the lifecycle state is read at that moment.
  useEffect(() => {
    if (!settled) {
      return;
    }
    const running = getCrewTrackingState();
    if (!running.foregroundActive && !running.backgroundActive) {
      return;
    }
    if (trip && isTripShareable(trip)) {
      return;
    }
    // A SCHEDULED copy of the very trip the lifecycle is tracking is a stale
    // read, not a closed trip: tracking only ever starts on a trip the server
    // confirmed as BOARDING/IN_PROGRESS, and a status never moves backwards.
    if (trip && trip.status === TripStatus.SCHEDULED && running.tripId === trip.id) {
      return;
    }
    void stopCrewTracking('trip-closed');
  }, [settled, trip?.id, trip?.status]);

  const statusDetail = useMemo(
    () =>
      deriveCrewTrackingStatus({
        foregroundActive: snapshot.foregroundActive,
        backgroundActive: snapshot.backgroundActive,
        foregroundPermission: snapshot.foregroundPermission,
        servicesEnabled: snapshot.servicesEnabled,
        connection: snapshot.connection,
        lastLocalFixAt: snapshot.stats.lastFix?.recorded_at ?? null,
        lastServerAckAt: snapshot.stats.lastAckAt,
        now: tick,
      }),
    // `tick` is what makes freshness age without new data.
    [snapshot, tick],
  );

  const issue = useMemo(
    () =>
      evaluateGpsPermissions({
        servicesEnabled: snapshot.servicesEnabled,
        foreground: permissionSnapshot(snapshot.foregroundPermission),
        background: permissionSnapshot(snapshot.backgroundPermission),
        backgroundRequired: snapshot.backgroundConsent,
      }).issue,
    [
      snapshot.servicesEnabled,
      snapshot.foregroundPermission,
      snapshot.backgroundPermission,
      snapshot.backgroundConsent,
    ],
  );

  // The line carries the lifecycle's stop context on top of the status copy:
  // a server-refused trip names the status, an exhausted reconnect budget
  // names the host it could not reach (`API_BASE_URL` host only — never the
  // full URL, so a misconfigured token-in-query can never leak into copy).
  const copy = crewTrackingStatusLine({
    status: statusDetail.status,
    serverAckAgeMs: statusDetail.serverAckAgeMs,
    localFixAgeMs: statusDetail.localFixAgeMs,
    // Ages are measured against the same `tick` the status was derived from, so
    // the line keeps ageing between fixes instead of freezing at the last one.
    formatAge: (ageMs) =>
      ageMs === null ? '' : formatRelative(new Date(tick - ageMs).toISOString(), tick),
    lastStopReason: snapshot.lastStopReason,
    lastStopTripStatus: snapshot.lastStopTripStatus,
    connection: snapshot.connection,
    apiBaseUrl: API_BASE_URL,
  });

  const startSharing = useCallback(async (tripOverride?: TripResponse) => {
    const currentTrip = tripOverride ?? tripRef.current;
    if (!currentTrip || !isTripShareable(currentTrip)) {
      return;
    }
    const who = identityRef.current;
    if (!who) {
      return;
    }
    await startCrewTracking({
      tripId: currentTrip.id,
      userId: who.userId,
      schoolId: who.schoolId,
    });
  }, []);

  const stopSharing = useCallback(async () => {
    await stopCrewTracking('user');
  }, []);

  const enableBackground = useCallback(async () => {
    await setBackgroundTrackingEnabled(true);
  }, []);

  const disableBackground = useCallback(async () => {
    await setBackgroundTrackingEnabled(false);
  }, []);

  const retry = useCallback(async () => {
    const currentTrip = tripRef.current;
    const who = identityRef.current;
    // Nothing running yet: Retry means "start sharing" for this trip.
    const running = getCrewTrackingState();
    if (!running.foregroundActive && !running.backgroundActive && currentTrip && who) {
      await startCrewTracking({
        tripId: currentTrip.id,
        userId: who.userId,
        schoolId: who.schoolId,
      });
      return;
    }
    await requestCrewTrackingRecovery();
  }, []);

  const openLocationSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      // The OS refused to open Settings: nothing to do. The strip keeps
      // showing the same blocker when the driver comes back.
    }
  }, []);

  const requestLocationPermission = useCallback(async () => {
    // The driver explicitly tapped this (the strip only offers it after a
    // refused start): ask the OS.
    const requested = await Location.requestForegroundPermissionsAsync().catch(() => null);
    await refreshCrewPermissions();
    if (mapPermissionState(requested) !== 'granted') {
      // Refused / "ask later": the lifecycle's message keeps naming the
      // blocker, and the button stays a permission request. No state change
      // is claimed.
      return;
    }
    // Granted: complete the start the driver already asked for (this button
    // exists because that start was refused — their intent is explicit).
    const currentTrip = tripRef.current;
    const who = identityRef.current;
    if (!currentTrip || !isTripShareable(currentTrip) || !who) {
      return;
    }
    await startCrewTracking({
      tripId: currentTrip.id,
      userId: who.userId,
      schoolId: who.schoolId,
    });
  }, []);

  const statusLine = t(copy.key, copy.params as never);
  const statusTone = crewTrackingStatusTone(statusDetail.status);
  const canShare = isTripShareable(trip);

  // One stable object per distinct state. Consumers key effects and callbacks
  // on this binding (`GpsPermissionRecovery`, the strips), so handing out a
  // fresh literal on every render would make "nothing changed" look like a
  // change and re-arm their work each time — the render loop this hook's
  // subscribers hit once. Every input is either a primitive, a reference the
  // lifecycle only replaces on publish, or a memoised derivation.
  return useMemo<CrewLocationSharing>(
    () => ({
      foregroundPermission: snapshot.foregroundPermission,
      backgroundPermission: snapshot.backgroundPermission,
      sharing: snapshot.foregroundActive,
      backgroundActive: snapshot.backgroundActive,
      backgroundConsent: snapshot.backgroundConsent,
      stats: snapshot.stats,
      busy: snapshot.busy,
      message: snapshot.message,
      canShare,
      statusDetail,
      status: statusDetail.status,
      statusLine,
      statusTone,
      issue,
      accuracy: snapshot.accuracy,
      servicesEnabled: snapshot.servicesEnabled,
      lastStopReason: snapshot.lastStopReason,
      connection: snapshot.connection,
      recovery: snapshot.recovery,
      trackingState: snapshot,
      startSharing,
      stopSharing,
      enableBackground,
      disableBackground,
      retry,
      openLocationSettings,
      requestLocationPermission,
    }),
    [
      snapshot,
      canShare,
      statusDetail,
      statusLine,
      statusTone,
      issue,
      startSharing,
      stopSharing,
      enableBackground,
      disableBackground,
      retry,
      openLocationSettings,
      requestLocationPermission,
    ],
  );
}

/**
 * Maps the lifecycle's coarse permission state back onto the snapshot shape the
 * pure evaluator reads (`unavailable` stays `null`, never "granted").
 */
function permissionSnapshot(
  mapped: PermissionState,
): { granted: boolean; canAskAgain: boolean } | null {
  if (mapped === 'unavailable') {
    return null;
  }
  return { granted: mapped === 'granted', canAskAgain: mapped !== 'denied' };
}
