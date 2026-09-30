import { Logger } from '../../framework';
import { ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS } from '../../config/eta.config';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  LIVE_TRACKING_EVENTS,
  TripArrivalDiagnostics,
  TripArrivalFixRejection,
  TripArrivalGateReason,
  TripArrivalPendingStop,
  TripProgressResponse,
  TripStopArrivalListResponse,
  TripStopArrivalResponse,
  TripStopArrivedEvent,
  TripStopSkippedEvent,
  TripStopWarning,
  TripEtaUpdateEvent,
  liveTrackingRoomName,
  type LiveTrackingEvent,
} from '@school-bus-tracking/shared-types';
import { getTripTrackingState, isTripArrivalRecording } from '@school-bus-tracking/validation';
import { Stop, Trip, TripLocation, TripStopArrival } from '../../database/models';
import { NotificationsService } from '../notifications/notifications.service';
import { EtaService, type EtaLocationFix } from './eta.service';
import {
  haversineMeters,
  isRecordableStop,
  stopCoordinateWarnings,
} from './geo.util';

/** Room-scoped broadcast sink attached by the tracking gateway once sockets are up. */
export type EtaRoomBroadcaster = (room: string, event: LiveTrackingEvent, payload: unknown) => void;

/** One recorded arrival produced by evaluating an accepted GPS fix. */
export interface RecordedStopArrival {
  stop: { id: string; name: string; sequence_number: number };
  row: TripStopArrival;
  distanceMeters: number;
}

/**
 * Phase 1 — environment-backed tuning of stop-arrival / proximity detection
 * (see `config/eta.config.ts`). Every default is justified in
 * `docs/notification-hardening-handoff.md`.
 */
export interface ArrivalDetectionConfig {
  /** Fixes older than this (by original `recorded_at`) never create alerts. */
  maxFixAgeMs: number;
  /** Fixes dated further ahead of the server clock are ineligible. */
  futureToleranceMs: number;
  /** Fixes with a worse horizontal accuracy are ineligible. */
  maxAccuracyMeters: number;
  /** Whether fixes without an accuracy reading stay eligible. */
  allowMissingAccuracy: boolean;
  /**
   * Runtime floor on every stop's EFFECTIVE geofence radius (default 50 —
   * `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS`). Evaluation uses
   * `effectiveStopRadiusMeters(stop, config) =
   * max(stop.geofence_radius_meters, this floor)` everywhere a stop's radius
   * participates: inside-evidence, the per-stop accuracy gate, the
   * departure-gate margin and candidate selection.
   *
   * Deep-fix R1: the field showed a bus parked at a stop whose live GPS
   * wandered ±3–6 m only ever recording when a fix landed almost exactly on
   * the stop's coordinates — the "zone behaves like a point" defect. Small
   * legacy radii (10–30 m) made that inevitable: the circle itself was
   * smaller than the phone's reported accuracy. The floor keeps the stored
   * radius as the admin's intent while guaranteeing every arrival zone is a
   * real circle a parked bus can stand inside. New/edited stops are
   * additionally required to be ≥ 30 m by validation; the floor catches
   * everything created before that.
   */
  minEffectiveRadiusMeters: number;
  /**
   * In-a-row fixes inside a geofence before a stop records. The immediately
   * next stop defaults to 2 (see `DEFAULT_ARRIVAL_DETECTION_CONFIG`): one fix
   * is vulnerable to GPS jitter, and the departure / inter-stop gates (not this
   * count) are what stop a stationary bus cascading through every stop.
   * Escalating tiers below still demand more consecutive runs for the
   * extraordinary claims (skipped-ahead, re-sync).
   */
  requiredConsecutiveFixes: number;
  /** Extra consecutive fixes for a stop ahead of the next unarrived stop. */
  skipExtraFixes: number;
  /** Tier boundary: stops further beyond the frontier need re-sync evidence. */
  maxSkipAhead: number;
  /**
   * Fringe band past the geofence edge preserving partial evidence. Doubles
   * as the departure-gate margin: the bus must be seen this far beyond the
   * frontier stop's edge before the next stop may record.
   */
  exitHysteresisMeters: number;
  /** Minimum span between first and confirming inside-fix (0 = disabled). */
  minDwellMs: number;
  /**
   * Minimum span between the previous arrival's `arrived_at` and the fix that
   * records the next stop (0 = disabled). Guards against a stationary bus
   * inside overlapping geofences recording a second stop instantly.
   */
  minInterStopMs: number;
  /**
   * Minimum distance between the fix that recorded the previous stop and the
   * fix recording the next one (0 = disabled). Kept tunable because some
   * routes have genuinely short legs.
   *
   * Deep-fix R2 turned the default OFF: the gate is route-blind, and on a
   * route whose consecutive stops sit closer than the threshold (legal data
   * at the legacy 10 m minimum radius — the editor's spacing rule is
   * `2 × the larger radius`, so a 30 m leg implies ≤ 15 m radii) it blocked
   * stop N+1 for the entire dwell, by which point the bus had left N+1's
   * geofence and the stop fell behind the frontier silently. The
   * anti-cascade load belongs to the departure gate (geometry-aware since
   * R2), the inter-stop cooldown, the dwell span and the consecutive-fix
   * count — none of which is distance-blind.
   */
  minInterStopDistanceMeters: number;
  /** Implied speed above which a fix is an implausible jump. */
  maxPlausibleSpeedKmh: number;
  /** Jumps shorter than this never trigger. */
  minJumpDistanceMeters: number;
}

/** Production defaults (mirrors `config/eta.config.ts` for tests/embeds). */
export const DEFAULT_ARRIVAL_DETECTION_CONFIG: ArrivalDetectionConfig = {
  maxFixAgeMs: 180_000,
  futureToleranceMs: 60_000,
  maxAccuracyMeters: 100,
  // A fix whose accuracy is unknown cannot be trusted to localise inside even
  // the effective circle, and a stationary bus parked indoors is exactly
  // where devices drop the field — so unknown-accuracy fixes are ineligible by
  // default (env-tunable per deployment). The anti-cascade defences are the
  // departure / dwell / cooldown gates, not this field.
  allowMissingAccuracy: false,
  // Deep-fix R1: every stop's effective radius is floored, so a legacy small
  // stop still gets a real circle. The number itself lives in exactly one
  // place — `config/eta.config.ts` — together with the reasoning for why it
  // is 25 m and must not be dropped to 5 m (a 5 m radius makes the accuracy
  // gate unsatisfiable for a typical phone fix).
  minEffectiveRadiusMeters: ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS,
  // The next unarrived stop records only after TWO consecutive eligible
  // in-geofence fixes with sustained presence (`minDwellMs`). One fix is
  // vulnerable to urban GPS jitter; the departure and inter-stop gates below
  // are what actually stop a stationary bus from cascading through every stop,
  // so the confirmation count is free to stay modest and the trip never
  // "sticks at first" — the crew manual-mark path remains the instant escape.
  requiredConsecutiveFixes: 2,
  skipExtraFixes: 1,
  maxSkipAhead: 2,
  exitHysteresisMeters: 20,
  minDwellMs: 10_000,
  minInterStopMs: 30_000,
  // Deep-fix R2: 0 (disabled). The route-blind distance floor is what silently
  // dropped close consecutive stops — see the config field doc above.
  minInterStopDistanceMeters: 0,
  maxPlausibleSpeedKmh: 150,
  minJumpDistanceMeters: 500,
};

/** Why a fix was rejected as arrival evidence (ingestion is unaffected). */
export type FixRejectionReason = TripArrivalFixRejection;

/** Last evaluated fix of a trip — the movement/jump reference point. */
interface LastFixReference {
  latitude: number;
  longitude: number;
  recordedMs: number;
}

/** Consecutive inside-geofence evidence accumulated for one stop. */
export interface StopInsideEvidence {
  count: number;
  /** `recorded_at` of the first fix of the current inside run. */
  sinceMs: number;
}

/**
 * Departure-gate memory for one trip. The next stop (any stop past the current
 * frontier) may only record once the bus has demonstrably moved on from the
 * frontier stop — otherwise a bus parked inside several overlapping geofences
 * records every stop one per fix. "Moved on" has been geometry-aware since
 * deep-fix R2 (see `hasMovedOnTowardAheadStop`): either the bus has been seen
 * OUTSIDE the frontier stop's effective geofence + hysteresis, or it is
 * inside a LATER stop's effective circle and strictly closer to that stop
 * than to the frontier — the only shape of "departed" a route with stops
 * 20–40 m apart can express, where the circles necessarily overlap. The
 * frontier stop id is derived from the arrival rows on every evaluation, so
 * the gate survives a process restart and honours crew-marked arrivals too;
 * only the "has departed yet" bit needs caching between fixes.
 */
export interface DepartureGateState {
  /** Highest-sequence arrived stop the gate is currently anchored on. */
  frontierStopId: string;
  /**
   * True once an eligible fix has been seen outside its effective geofence
   * (stored radius floored at `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS`) +
   * hysteresis, or demonstrably moved on toward a later stop.
   */
  departed: boolean;
}

/**
 * Task 22 — stop arrival detection over the existing live-tracking pipeline,
 * hardened by Phase 1 (`docs/notification-hardening-handoff.md`).
 *
 * For every accepted *latest* GPS fix of an active trip (invoked by
 * `LiveTrackingService.recordLocation` after the fix is persisted and
 * broadcast) the service:
 *
 * 1. gates the fix on freshness and quality — historical ingestion is
 *    untouched (every accepted fix is still persisted and stays in history),
 *    but only fresh, accurate, plausible fixes are eligible to raise a
 *    *current* alert. The gate uses the original fix time (`recorded_at`),
 *    never the server receipt time;
 * 2. loads the trip's route stops, pinned to `(school_id, route_id)` — a fix
 *    of another trip/school can never be matched against them;
 * 3. accumulates consecutive inside-geofence evidence per stop (with an exit
 *    hysteresis fringe so edge jitter does not wipe it) and selects at most
 *    one candidate under the progression policy — ascending route order with
 *    escalating evidence for skipped-ahead stops and explicit re-sync past
 *    the skip window, so one missed stop never blocks later stops;
 * 4. records the arrival row, broadcasts `trip:stop:arrived` to the trip's
 *    Socket.IO room (room membership is itself authorization-gated) and asks
 *    the notifications service to notify the parents of this trip/run's
 *    riders whose home stop was reached.
 *
 * Detection proves proximity only — the parent-facing copy says "near", not
 * "arrived/boarded". The whole evaluation is best-effort: any failure is
 * logged and swallowed, and can never reject an otherwise accepted GPS fix.
 *
 * The domain supports one direction only: ascending stop `sequence_number`.
 * There is no reverse-trip concept, and straight-line GPS cannot reliably
 * distinguish a stop from a parallel road — the policy therefore confirms
 * sustained presence, never lane-level truth. No routing service is used.
 */
export class StopArrivalsService {
  private readonly logger = new Logger(StopArrivalsService.name);

  /** Broadcaster attached by the tracking gateway; `undefined` in unit tests. */
  private broadcaster: EtaRoomBroadcaster | undefined;

  /** Per-process stops already recorded for a trip (the DB index is the cross-process backstop). */
  private readonly seenByTrip = new Map<string, Set<string>>();

  /** Last evaluated fix per trip — the implausible-jump reference. */
  private readonly lastFixByTrip = new Map<string, LastFixReference>();

  /** Consecutive inside-geofence evidence per trip per stop. */
  private readonly insideByTrip = new Map<string, Map<string, StopInsideEvidence>>();

  /** Why the newest evaluated fix of a trip produced no evidence (diagnostics). */
  private readonly lastRejectionByTrip = new Map<string, FixRejectionReason | null>();

  /** Departure-gate memory per trip (the "has left the last stop yet" bit). */
  private readonly departureByTrip = new Map<string, DepartureGateState>();

  /** Why the newest *eligible* fix of a trip still recorded nothing (a gate). */
  private readonly lastGateBlockByTrip = new Map<string, TripArrivalGateReason | null>();

  /** Trips whose un-surveyed stops were already warned about (once per process). */
  private readonly warnedByTrip = new Map<string, Set<string>>();

  /**
   * Stops whose `trip:stop:skipped` broadcast already went out for a trip
   * (once per process; the frontier only moves forward, so the derivation
   * would otherwise re-find the same passed stop on every later arrival).
   */
  private readonly skipAnnouncedByTrip = new Map<string, Set<string>>();

  constructor(
    private readonly stops: typeof Stop,
    private readonly arrivals: typeof TripStopArrival,
    private readonly eta: EtaService,
    private readonly notifications: NotificationsService,
    private readonly config: ArrivalDetectionConfig = DEFAULT_ARRIVAL_DETECTION_CONFIG,
    /**
     * Connection used to commit the arrival and its notification fan-out in
     * one transaction (fix D). Injected by the container; when absent (unit
     * tests, embedders) the model's own connection is used, and when neither
     * exists the writes fall back to the legacy sequential path.
     */
    private readonly sequelize: Sequelize | null = null,
  ) {}

  /** Attach (or replace) the room broadcaster; the gateway does this once. */
  attachBroadcaster(broadcaster: EtaRoomBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /** Drop the broadcaster (used in tests); emissions become no-ops. */
  detachBroadcaster(): void {
    this.broadcaster = undefined;
  }

  /**
   * Evaluates one accepted fix of an active trip: freshness/quality gating,
   * geofence detection, arrival recording, arrival/ETA broadcasts and parent
   * notification. Best-effort by design — errors are logged, never re-thrown,
   * so the tracking pipeline stays unaffected.
   *
   * `now` is the server reference clock (the fix receipt time in production);
   * freshness is always measured from the fix's own `recorded_at` against it.
   */
  async onAcceptedFix(
    trip: Trip,
    fix: TripLocation,
    now: Date = new Date(),
  ): Promise<RecordedStopArrival | null> {
    try {
      // GPS sharing is allowed during BOARDING, but arrival evidence is not:
      // no routes, ETA progress, last-fix reference or inside-geofence state
      // is touched before IN_PROGRESS. That makes the first in-progress fix
      // stand on its own evidence instead of inheriting a boarding-phase stop.
      if (!isTripArrivalRecording(trip.status)) {
        return null;
      }

      const routeStops = await this.loadRouteStops(trip);
      const existingArrivals = await this.loadArrivals(trip);
      const recorded = await this.recordCandidateArrival(
        trip,
        fix,
        routeStops,
        existingArrivals,
        now,
      );

      // Recompute and broadcast the approximate ETA after every accepted
      // latest fix (and immediately after an arrival, so the next-stop state
      // advances in the same broadcast round). `now` lets the ETA withhold
      // distances derived from stale GPS instead of presenting them as fresh.
      const etaResponse = await this.eta.computeTripEta({
        trip,
        latest: fix,
        stops: routeStops,
        arrivals: recorded ? [...existingArrivals, recorded.row] : existingArrivals,
        now,
      });
      const etaEvent: TripEtaUpdateEvent = {
        trip_id: trip.id,
        school_id: trip.school_id,
        eta: etaResponse,
      };
      this.emitToTrip(trip.id, LIVE_TRACKING_EVENTS.etaUpdate, etaEvent);

      return recorded;
    } catch (error) {
      this.logger.error(
        `Stop arrival evaluation failed for trip ${trip.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Crew stop marking — the manual write path behind
   * `POST /trips/:tripId/stops/:stopId/arrive` and `.../skip`.
   *
   * It lands in the **same** `trip_stop_arrivals` table as the geofence
   * pipeline, so the progress frontier, the ETA's `next_stop` and the
   * arrivals read all keep exactly one source of truth; the new `source`
   * column is what tells the two apart afterwards.
   *
   * Authorisation, the trip's open state and the reason's shape are the
   * caller's job (`CrewStopMarkingService`) — this method is the writer.
   *
   * **Idempotent by construction.** A stop that already has a row (recorded
   * by GPS seconds earlier, or by a replayed offline-queue tap) is returned
   * as-is with `created: false`: no second row, no second notification, no
   * second broadcast. The unique `(school_id, trip_id, stop_id)` index is the
   * cross-process backstop for the same rule, and a racing insert is caught
   * and re-read rather than surfaced as a 500.
   *
   * Notifications and the `trip:stop:arrived` broadcast run for an **arrival**
   * only. A skip means the bus did not serve the stop, so telling a parent
   * "the bus reached your stop" would be a lie; the school still sees it,
   * because the row (and its `skip_reason`) is in the arrivals read the trip
   * detail already uses.
   */
  async recordCrewStopMark(args: {
    trip: Trip;
    stop: { id: string; name: string; sequence_number: number };
    actorUserId: string;
    /** Non-null makes this a skip; null is a plain crew-marked arrival. */
    skipReason: string | null;
    now?: Date;
  }): Promise<{ row: TripStopArrival; created: boolean }> {
    const { trip, stop, actorUserId, skipReason } = args;
    const now = args.now ?? new Date();

    const existing = await this.findArrival(trip, stop.id);
    if (existing) {
      this.markSeen(trip.id, stop.id);
      return { row: existing, created: false };
    }

    let row: TripStopArrival;
    try {
      row = await this.persistCrewMark({ trip, stop, actorUserId, skipReason, now });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Another device (or the geofence evaluator) recorded the same visit
        // first. The caller asked for "this stop is recorded"; it is.
        const raced = await this.findArrival(trip, stop.id);
        if (raced) {
          this.markSeen(trip.id, stop.id);
          return { row: raced, created: false };
        }
      }
      throw error;
    }

    // The evaluator must not re-record what the crew just recorded.
    this.markSeen(trip.id, stop.id);
    this.insideForTrip(trip.id).delete(stop.id);

    if (skipReason === null) {
      const event: TripStopArrivedEvent = {
        trip_id: trip.id,
        school_id: trip.school_id,
        trip_status: trip.status,
        tracking_state: getTripTrackingState(trip.status),
        stop_id: stop.id,
        stop_name: stop.name,
        sequence_number: stop.sequence_number,
        arrived_at: toIsoString(row.arrived_at),
        latitude: null,
        longitude: null,
        distance_meters: null,
        source: 'crew',
      };
      this.emitToTrip(trip.id, LIVE_TRACKING_EVENTS.stopArrived, event);
    }

    // Deep-fix R2 — no more silent skips: a crew mark can advance the frontier
    // past OTHER unarrived stops ("Arrived" at stop 3 passes stop 2). The
    // marked stop itself is never re-announced (it has a row — for a skip,
    // the row's `skip_reason` is the school's record and the tapping device
    // already spoke its receipt). Only the newly-created path reaches here:
    // the already-recorded early-return above never moves the frontier.
    {
      const [routeStops, arrivals] = await Promise.all([
        this.loadRouteStops(trip),
        this.loadArrivals(trip),
      ]);
      this.announceStopsPassedByFrontier(trip, routeStops, arrivals, 'crew', now);
    }

    return { row, created: true };
  }

  /**
   * Broadcasts `trip:stop:skipped` for every active stop the (new) frontier
   * has moved past without an arrival row — once per stop per trip per
   * process, so replayed evaluations and later frontier moves never double-
   * announce. Best-effort by construction (same as every broadcast here): a
   * failure is logged and swallowed.
   */
  private announceStopsPassedByFrontier(
    trip: Trip,
    routeStops: Stop[],
    arrivals: TripStopArrival[],
    source: TripStopArrivedEvent['source'],
    now: Date,
  ): void {
    const frontierStop = this.frontierArrivedStop(routeStops, arrivals);
    if (frontierStop === null) return;
    const arrivalStopIds = new Set(arrivals.map((arrival) => arrival.stop_id));
    const passed = stopsPassedByFrontier(routeStops, arrivalStopIds, frontierStop.sequence_number);
    if (passed.length === 0) return;

    const announced = this.skipAnnouncedByTrip.get(trip.id) ?? new Set<string>();
    for (const stop of passed) {
      if (announced.has(stop.id)) continue;
      announced.add(stop.id);
      const event: TripStopSkippedEvent = {
        trip_id: trip.id,
        school_id: trip.school_id,
        trip_status: trip.status,
        tracking_state: getTripTrackingState(trip.status),
        stop_id: stop.id,
        stop_name: stop.name,
        sequence_number: stop.sequence_number,
        skipped_at: now.toISOString(),
        source,
      };
      this.emitToTrip(trip.id, LIVE_TRACKING_EVENTS.stopSkipped, event);
      this.logger.warn(
        `Trip ${trip.id} passed stop ${stop.id} ("${stop.name}", sequence ` +
          `${stop.sequence_number}) without recording it — announced as skipped ` +
          `(frontier moved to ${frontierStop.sequence_number} via ${source}).`,
      );
    }
    this.skipAnnouncedByTrip.set(trip.id, announced);
  }

  /** The existing arrival row of one trip-stop, tenant-pinned. */
  private async findArrival(trip: Trip, stopId: string): Promise<TripStopArrival | null> {
    return this.arrivals.findOne({
      where: { school_id: trip.school_id, trip_id: trip.id, stop_id: stopId },
    });
  }

  /**
   * Writes one crew-marked row — and, for an arrival, its parent
   * notifications in the same transaction, for the same reason the geofence
   * path does it (fix D): a committed arrival always has its alert intent,
   * and a rollback leaves neither.
   *
   * No coordinates are stored. The crew pressed a button; the phone's GPS may
   * have been off, and inventing a position (the stop's own, or 0/0) would be
   * indistinguishable from a measured fix in every downstream read.
   */
  private async persistCrewMark(args: {
    trip: Trip;
    stop: { id: string; name: string };
    actorUserId: string;
    skipReason: string | null;
    now: Date;
  }): Promise<TripStopArrival> {
    const { trip, stop, actorUserId, skipReason, now } = args;

    const create = (transaction?: Transaction): Promise<TripStopArrival> =>
      this.arrivals.create(
        {
          school_id: trip.school_id,
          trip_id: trip.id,
          stop_id: stop.id,
          arrived_at: now,
          latitude: null,
          longitude: null,
          distance_meters: null,
          source: 'crew',
          skip_reason: skipReason,
          recorded_by: actorUserId,
        },
        ...(transaction ? [{ transaction }] : []),
      );

    const notify = (transaction?: Transaction): Promise<void> => {
      if (skipReason !== null) {
        // A skipped stop was not served: no parent is told anything.
        return Promise.resolve();
      }
      return this.notifications.notifyStopArrival(
        {
          school_id: trip.school_id,
          trip_id: trip.id,
          stop: { id: stop.id, name: stop.name },
          occurred_at: now,
        },
        transaction ? { transaction } : {},
      );
    };

    const sequelize =
      this.sequelize ?? (this.arrivals as unknown as { sequelize?: Sequelize }).sequelize;
    if (!sequelize) {
      const row = await create();
      await notify();
      return row;
    }
    return sequelize.transaction(async (transaction) => {
      const row = await create(transaction);
      await notify(transaction);
      return row;
    });
  }

  /** Drops the per-process arrival memory once a trip becomes terminal. */
  resetForTrip(tripId: string): void {
    this.seenByTrip.delete(tripId);
    this.lastFixByTrip.delete(tripId);
    this.insideByTrip.delete(tripId);
    this.lastRejectionByTrip.delete(tripId);
    this.departureByTrip.delete(tripId);
    this.lastGateBlockByTrip.delete(tripId);
    this.warnedByTrip.delete(tripId);
    this.skipAnnouncedByTrip.delete(tripId);
  }

  /**
   * `GET /trips/:tripId/arrivals` — every recorded arrival of an
   * already-authorized trip, in arrival order, with the stop name resolved.
   */
  async listArrivals(trip: Trip): Promise<TripStopArrivalListResponse> {
    const [arrivals, stops] = await Promise.all([
      this.loadArrivals(trip),
      this.loadRouteStops(trip),
    ]);
    return {
      trip_id: trip.id,
      school_id: trip.school_id,
      items: this.mapArrivals(arrivals, stops),
    };
  }

  /**
   * `GET /trips/:tripId/progress` — crew-facing snapshot: latest arrival,
   * next stop, all recorded arrivals and the ETA summary. `now` gates ETA
   * freshness the same way the live pipeline does.
   */
  async getProgress(
    trip: Trip,
    latest: EtaLocationFix | null,
    now: Date = new Date(),
  ): Promise<TripProgressResponse> {
    const [stops, arrivals] = await Promise.all([
      this.loadRouteStops(trip),
      this.loadArrivals(trip),
    ]);
    const eta = await this.eta.computeTripEta({ trip, latest, stops, arrivals, now });
    return {
      trip_id: trip.id,
      school_id: trip.school_id,
      trip_status: trip.status,
      tracking_state: getTripTrackingState(trip.status),
      current_stop: eta.current_stop,
      next_stop: eta.next_stop,
      arrivals: this.mapArrivals(arrivals, stops),
      eta,
      arrival_diagnostics: this.buildArrivalDiagnostics(trip, stops, arrivals),
    };
  }

  /**
   * The support-facing answer to "why is next stop not moving?": un-surveyable
   * stops, per-stop evidence against its confirmation tier, the frontier
   * arrival, the departure gate, and the reason the newest evaluated fix
   * produced nothing (an eligibility rejection or a progression gate). Pure
   * composition of state the evaluator already keeps — never another source of
   * truth.
   */
  private buildArrivalDiagnostics(
    trip: Trip,
    stops: Stop[],
    arrivals: TripStopArrival[],
  ): TripArrivalDiagnostics {
    const unsurveyedStops: TripStopWarning[] = stopCoordinateWarnings(stops);
    this.warnUnsurveyedStops(trip.id, unsurveyedStops);

    const arrivedIds = new Set(arrivals.map((arrival) => arrival.stop_id));
    const frontierStop = this.frontierArrivedStop(stops, arrivals);
    const frontier = frontierStop?.sequence_number ?? 0;
    const nextUnarrived = [...stops]
      .filter((stop) => !arrivedIds.has(stop.id) && isValidGeofenceStop(stop))
      .sort((a, b) => a.sequence_number - b.sequence_number)[0];

    // The departure gate as last measured; a frontier with no cached bit means
    // no eligible fix has been evaluated against it yet (default: not departed).
    const gateState = frontierStop
      ? this.departureByTrip.get(trip.id)
      : undefined;
    const departed =
      frontierStop === null
        ? true
        : gateState?.frontierStopId === frontierStop.id
          ? gateState.departed
          : false;

    const lastArrival = this.previousArrival(arrivals);
    const departureBlocks = frontierStop !== null && !departed;

    const inside = this.insideByTrip.get(trip.id) ?? new Map<string, StopInsideEvidence>();
    const pendingStops = stops
      .filter(
        (stop) => !arrivedIds.has(stop.id) && stop.sequence_number > frontier && isValidGeofenceStop(stop),
      )
      .sort((a, b) => a.sequence_number - b.sequence_number);
    const pending_stops: TripArrivalPendingStop[] = pendingStops.map((stop, index) => ({
      stop_id: stop.id,
      stop_name: stop.name,
      sequence_number: stop.sequence_number,
      inside_count: inside.get(stop.id)?.count ?? 0,
      required_fixes: requiredFixesForProgression(
        stop.sequence_number,
        frontier,
        nextUnarrived?.sequence_number ?? 0,
        this.config,
      ),
      // Only the immediate next stop is meaningfully "gated": the departure
      // gate holds every stop past the frontier, so the first pending one
      // carries the reason support looks for.
      blocked_reason: index === 0 && departureBlocks ? 'awaiting-departure' : null,
    }));

    return {
      last_fix_rejection: this.lastRejectionByTrip.get(trip.id) ?? null,
      last_gate_block: this.lastGateBlockByTrip.get(trip.id) ?? null,
      last_arrival: lastArrival
        ? {
            stop_id: lastArrival.stop_id,
            stop_name: stops.find((stop) => stop.id === lastArrival.stop_id)?.name ?? 'Unknown stop',
            sequence_number:
              stops.find((stop) => stop.id === lastArrival.stop_id)?.sequence_number ?? 0,
            arrived_at: toIsoString(lastArrival.arrived_at),
            gated_until:
              this.config.minInterStopMs > 0
                ? new Date(toMs(lastArrival.arrived_at) + this.config.minInterStopMs).toISOString()
                : null,
          }
        : null,
      departure_gate: frontierStop
        ? {
            frontier_stop_id: frontierStop.id,
            frontier_stop_name: frontierStop.name,
            sequence_number: frontierStop.sequence_number,
            departed,
          }
        : null,
      unsurveyed_stops: unsurveyedStops,
      pending_stops,
    };
  }

  /** Warns once per trip+stop that an un-surveyed stop can never auto-record. */
  private warnUnsurveyedStops(tripId: string, unsurveyed: TripStopWarning[]): void {
    if (unsurveyed.length === 0) return;
    let warned = this.warnedByTrip.get(tripId);
    if (!warned) {
      warned = new Set<string>();
      this.warnedByTrip.set(tripId, warned);
    }
    for (const stop of unsurveyed) {
      if (warned.has(stop.stop_id)) continue;
      warned.add(stop.stop_id);
      this.logger.warn(
        `Route stop ${stop.stop_id} ("${stop.stop_name}", sequence ${stop.sequence_number}) ` +
          `has no coordinates — it can never record an automatic arrival for trip ${tripId}. ` +
          'The trip must skip past it; survey the stop or adjust the plan.',
      );
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Gates one fix on freshness/quality, accumulates inside-geofence evidence
   * and records at most one arrival for the progression winner. Duplicate
   * protection comes from the in-memory per-trip set, the existence check
   * and — as the cross-process backstop — the unique
   * `(school_id, trip_id, stop_id)` index (a racing insert is caught and
   * treated as "already recorded").
   */
  private async recordCandidateArrival(
    trip: Trip,
    fix: TripLocation,
    routeStops: Stop[],
    existingArrivals: TripStopArrival[],
    now: Date,
  ): Promise<RecordedStopArrival | null> {
    const nowMs = now.getTime();
    const recordedMs = toMs(fix.recorded_at);
    if (!Number.isFinite(recordedMs)) {
      return null;
    }

    const fixPoint = {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy ?? null,
      recordedMs,
    };
    const lastFix = this.lastFixByTrip.get(trip.id) ?? null;
    const eligibility = assessFixEligibility(fixPoint, lastFix, nowMs, this.config);
    if (!eligibility.eligible) {
      // Diagnostics: the newest fix rejected as arrival evidence, with the
      // reason — the explanation the progress endpoint hands to support.
      this.lastRejectionByTrip.set(trip.id, eligibility.reason ?? 'stale');
      // A jump still advances the reference point: one glitch then costs at
      // most two fixes, and a genuine relocation re-syncs immediately
      // instead of poisoning every later comparison. Stale, future-dated and
      // inaccurate fixes are not trustworthy movement evidence, so they leave
      // the reference (and all inside-counts) untouched.
      if (eligibility.reason === 'implausible-jump') {
        this.lastFixByTrip.set(trip.id, {
          latitude: fix.latitude,
          longitude: fix.longitude,
          recordedMs,
        });
        this.logger.debug(`Ignoring implausible GPS jump for trip ${trip.id} (fix ${fix.id}).`);
      }
      return null;
    }
    this.lastFixByTrip.set(trip.id, {
      latitude: fix.latitude,
      longitude: fix.longitude,
      recordedMs,
    });
    this.lastRejectionByTrip.set(trip.id, null);
    // This is an eligible fix: any "no arrival" outcome below is either "no
    // candidate" (cleared here) or a gate block (set explicitly).
    this.lastGateBlockByTrip.set(trip.id, null);

    const arrivedStopIds = new Set(existingArrivals.map((arrival) => arrival.stop_id));
    const seen = this.seenByTrip.get(trip.id);
    const inside = this.insideForTrip(trip.id);
    updateInsideEvidence(
      inside,
      routeStops,
      arrivedStopIds,
      seen,
      { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy ?? null },
      recordedMs,
      this.config.exitHysteresisMeters,
      this.config,
    );

    // Departure gate — updated on EVERY eligible fix (even one that selects no
    // candidate) so the moment the bus leaves the last stop is never missed.
    const frontierStop = this.frontierArrivedStop(routeStops, existingArrivals);
    const departed = this.updateDepartureGate(
      trip.id,
      frontierStop,
      fix,
      routeStops,
      arrivedStopIds,
    );

    const selection = selectProgressionCandidate({
      stops: routeStops,
      arrivedStopIds,
      seenStopIds: seen,
      inside,
      fix: { latitude: fix.latitude, longitude: fix.longitude, recordedMs },
      config: this.config,
    });
    if (!selection) {
      return null;
    }
    const candidate = selection.stop;
    const distanceMeters = selection.distanceMeters;

    // Progression gates. The candidate has the geofence evidence; these decide
    // whether the trip has actually MOVED on from the previous stop. Without
    // them a bus parked inside overlapping geofences records every stop, one
    // per fix — the field cascade. A blocked candidate is not recorded and
    // leaves no side effects, so it re-qualifies the instant the gate clears.
    const gateBlock = this.evaluateProgressionGates({
      trip,
      frontierStop,
      departed,
      previousArrival: this.previousArrival(existingArrivals),
      fix,
      recordedMs,
    });
    if (gateBlock !== null) {
      this.lastGateBlockByTrip.set(trip.id, gateBlock);
      this.logger.debug(
        `Holding stop ${candidate.id} for trip ${trip.id}: ${gateBlock} (fix ${fix.id}).`,
      );
      return null;
    }

    // Fix D — the arrival row and its parent-notification fan-out commit
    // together (or not at all). A crash after the arrival was saved used to
    // lose the alert permanently, because the arrival's own deduplication
    // (`(school_id, trip_id, stop_id)`) blocked any retry. Writing the
    // notification rows inside the arrival's transaction removes that window:
    // either both persist, or the arrival is re-evaluated on the next fix.
    //
    // The fan-out only ever *persists* rows — no FCM/APNs call happens on this
    // path (the outbox worker delivers later, off the GPS request), and the
    // socket broadcast is deferred to after commit so a rollback cannot
    // announce an arrival that never happened.
    const arrivedAt = new Date(Math.min(recordedMs, nowMs));
    let row: TripStopArrival;
    try {
      row = await this.persistArrivalWithNotifications({
        trip,
        candidate,
        fix,
        arrivedAt,
        distanceMeters,
      });
    } catch (error) {
      // Another evaluation (or instance) recorded the same visit first — the
      // unique index turned the race into a no-op. No second event/notification.
      if (isUniqueViolation(error)) {
        this.markSeen(trip.id, candidate.id);
        return null;
      }
      throw error;
    }

    this.markSeen(trip.id, candidate.id);
    inside.delete(candidate.id);

    const event: TripStopArrivedEvent = {
      trip_id: trip.id,
      school_id: trip.school_id,
      trip_status: trip.status,
      tracking_state: getTripTrackingState(trip.status),
      stop_id: candidate.id,
      stop_name: candidate.name,
      sequence_number: candidate.sequence_number,
      arrived_at: toIsoString(row.arrived_at),
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      distance_meters: row.distance_meters ?? null,
      source: 'geofence',
    };
    this.emitToTrip(trip.id, LIVE_TRACKING_EVENTS.stopArrived, event);

    // Deep-fix R2 — no more silent skips: if this arrival advanced the
    // frontier past stops that were never served, the room hears about each
    // one exactly once. (Not inside the transaction: a broadcast must never
    // be able to roll an arrival back, and the once-per-stop memory makes a
    // replay harmless.)
    this.announceStopsPassedByFrontier(
      trip,
      routeStops,
      [...existingArrivals, row],
      'geofence',
      now,
    );

    // Parent notification rows were already persisted inside the arrival's
    // transaction (fix D). Nothing to do here — the outbox delivers them, and
    // the notifications service broadcast the inbox event after commit.

    return {
      stop: {
        id: candidate.id,
        name: candidate.name,
        sequence_number: candidate.sequence_number,
      },
      row,
      distanceMeters: distanceMeters,
    };
  }

  /**
   * Persists the arrival and the parent notification rows in one transaction.
   *
   * The insert of the arrival row and every `notifications` row share the
   * same transaction, so:
   *
   * - a committed arrival always has its notification intent (no lost alert);
   * - a rollback (crash, notification failure, unique-index race) leaves no
   *   arrival, no inbox row and no outbound delivery work;
   * - the `(school_id, user_id, dedup_key)` unique index still makes a
   *   replayed fan-out idempotent — a resumed/re-created attempt cannot
   *   produce duplicate inbox rows.
   *
   * Without a database connection (unit-test/embedding scenario) the two
   * writes run sequentially, exactly as before this patch.
   */
  private async persistArrivalWithNotifications(args: {
    trip: Trip;
    candidate: { id: string; name: string };
    fix: TripLocation;
    arrivedAt: Date;
    distanceMeters: number;
  }): Promise<TripStopArrival> {
    const { trip, candidate, fix, arrivedAt, distanceMeters } = args;
    const createArrival = (transaction?: Transaction): Promise<TripStopArrival> =>
      this.arrivals.create(
        {
          school_id: trip.school_id,
          trip_id: trip.id,
          stop_id: candidate.id,
          // The bus was there at the fix's original time, not at evaluation
          // time; clamped to `now` so clock skew can never date an arrival in
          // the future.
          arrived_at: arrivedAt,
          latitude: fix.latitude,
          longitude: fix.longitude,
          distance_meters: distanceMeters,
          // Stated, never defaulted: the row's provenance is a fact of the
          // write, and the crew path sets its own value the same way.
          source: 'geofence',
          skip_reason: null,
          recorded_by: null,
        },
        ...(transaction ? [{ transaction }] : []),
      );

    const notify = (transaction?: Transaction): Promise<void> =>
      this.notifications.notifyStopArrival(
        {
          school_id: trip.school_id,
          trip_id: trip.id,
          stop: { id: candidate.id, name: candidate.name },
          occurred_at: arrivedAt,
        },
        transaction ? { transaction } : {},
      );

    const sequelize =
      this.sequelize ?? (this.arrivals as unknown as { sequelize?: Sequelize }).sequelize;
    if (!sequelize) {
      const row = await createArrival();
      await notify();
      return row;
    }

    return sequelize.transaction(async (transaction) => {
      const row = await createArrival(transaction);
      await notify(transaction);
      return row;
    });
  }

  /** Ordered stops of the trip's route, tenant-pinned. */
  private async loadRouteStops(trip: Trip): Promise<Stop[]> {
    return this.stops.findAll({
      where: { school_id: trip.school_id, route_id: trip.route_id },
      order: [['sequence_number', 'ASC']],
    });
  }

  /** Existing arrivals of the trip, tenant-pinned, in arrival order. */
  private async loadArrivals(trip: Trip): Promise<TripStopArrival[]> {
    return this.arrivals.findAll({
      where: { school_id: trip.school_id, trip_id: trip.id },
      order: [['arrived_at', 'ASC']],
    });
  }

  /** Explicit projection of one arrival row with the stop name resolved. */
  private mapArrivals(arrivals: TripStopArrival[], stops: Stop[]): TripStopArrivalResponse[] {
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));
    return arrivals.map((arrival) => ({
      id: arrival.id,
      school_id: arrival.school_id,
      trip_id: arrival.trip_id,
      stop_id: arrival.stop_id,
      stop_name: stopById.get(arrival.stop_id)?.name ?? 'Unknown stop',
      arrived_at: toIsoString(arrival.arrived_at),
      latitude: arrival.latitude ?? null,
      longitude: arrival.longitude ?? null,
      distance_meters: arrival.distance_meters ?? null,
      // Rows written before crew marking existed have no `source` value in
      // memory until the column default is read back; `geofence` is what
      // every one of them is, so the projection is stable either way.
      source: arrival.source ?? 'geofence',
      skip_reason: arrival.skip_reason ?? null,
      recorded_by: arrival.recorded_by ?? null,
      created_at: toIsoString(arrival.created_at),
    }));
  }
  /**
   * The highest-sequence stop with an arrival row — the progress frontier the
   * departure gate anchors on. Derived from the arrival rows loaded per
   * evaluation (not a cache), so it survives a process restart and reflects
   * crew-marked arrivals identically to geofence ones. A crew-marked stop that
   * is not on the loaded route (should not happen) is simply ignored.
   */
  private frontierArrivedStop(routeStops: Stop[], arrivals: TripStopArrival[]): Stop | null {
    const arrivedIds = new Set(arrivals.map((arrival) => arrival.stop_id));
    let frontier: Stop | null = null;
    for (const stop of routeStops) {
      if (!arrivedIds.has(stop.id)) continue;
      if (!Number.isFinite(stop.sequence_number)) continue;
      if (frontier === null || stop.sequence_number > frontier.sequence_number) {
        frontier = stop;
      }
    }
    return frontier;
  }

  /**
   * Updates and returns the departure-gate bit for the current frontier stop:
   * has the bus demonstrably moved on from it? Two shapes of "moved on",
   * either of which opens the gate:
   *
   * 1. an eligible fix has been seen OUTSIDE the frontier stop's EFFECTIVE
   *    geofence (plus the hysteresis fringe) — the classic departure;
   * 2. (deep-fix R2) the bus is inside a LATER stop's effective circle and
   *    strictly closer to that stop than to the frontier — see
   *    {@link hasMovedOnTowardAheadStop}. Without this clause a route whose
   *    consecutive stops sit closer than `effectiveRadius + hysteresis`
   *    (70 m at the defaults) can NEVER open the gate while legitimately
   *    standing at the next stop: stop N+1 stayed blocked the whole dwell,
   *    then fell behind the frontier silently — the "stop 2 was never
   *    announced" field defect.
   *
   * Resets to `false` whenever the frontier stop changes (a new arrival just
   * landed). A frontier stop with no usable coordinates cannot be measured
   * against, so the gate opens (an unsurveyable crew-marked stop must never
   * hold the trip hostage).
   */
  private updateDepartureGate(
    tripId: string,
    frontierStop: Stop | null,
    fix: TripLocation,
    routeStops: Stop[],
    arrivedStopIds: ReadonlySet<string>,
  ): boolean {
    if (frontierStop === null) {
      // No arrival yet: the first stop is free to record on its own evidence.
      this.departureByTrip.delete(tripId);
      return true;
    }
    const cached = this.departureByTrip.get(tripId);
    let departed = cached?.frontierStopId === frontierStop.id ? cached.departed : false;
    if (!departed) {
      const distance = haversineMeters(
        fix.latitude,
        fix.longitude,
        frontierStop.latitude,
        frontierStop.longitude,
      );
      if (distance === null) {
        // Cannot measure departure from an unsurveyed frontier — do not hold.
        departed = true;
      } else if (
        distance >
        effectiveStopRadiusMeters(frontierStop, this.config) + this.config.exitHysteresisMeters
      ) {
        departed = true;
      } else {
        // Still inside the frontier's circle: the only other legitimate
        // "moved on" is standing at a later stop (close-stop routes, where
        // the circles overlap). A stationary bus at the frontier itself is
        // never closer to a later stop than to the frontier, so the
        // stationary cascade stays blocked.
        departed = hasMovedOnTowardAheadStop({
          fix: { latitude: fix.latitude, longitude: fix.longitude },
          frontierStop,
          routeStops,
          arrivedStopIds,
          config: this.config,
        });
      }
    }
    this.departureByTrip.set(tripId, { frontierStopId: frontierStop.id, departed });
    return departed;
  }

  /** The most recent arrival by `arrived_at` — the previous stop, for the inter-stop gates. */
  private previousArrival(arrivals: TripStopArrival[]): TripStopArrival | null {
    let latest: TripStopArrival | null = null;
    for (const arrival of arrivals) {
      if (latest === null || toMs(arrival.arrived_at) > toMs(latest.arrived_at)) {
        latest = arrival;
      }
    }
    return latest;
  }

  /**
   * The progression gates applied to a selected candidate. Returns the reason
   * the candidate must be held back, or `null` when it is free to record:
   *
   * - **departure** — a stop past the frontier may only record once the bus
   *   has demonstrably moved on from the frontier stop (`updateDepartureGate`
   *   — outside its effective geofence, or at a later stop on a close-stop
   *   route);
   * - **inter-stop time** — the previous arrival is more recent than
   *   `minInterStopMs`, measured by the fix's own `recorded_at`;
   * - **inter-stop distance** (disabled by default since deep-fix R2) — the
   *   fix is closer than `minInterStopDistanceMeters` to the fix that
   *   recorded the previous stop (skipped when the previous arrival has no
   *   coordinates, e.g. a crew mark, and entirely when the gate is 0).
   */
  private evaluateProgressionGates(args: {
    trip: Trip;
    frontierStop: Stop | null;
    departed: boolean;
    previousArrival: TripStopArrival | null;
    fix: TripLocation;
    recordedMs: number;
  }): TripArrivalGateReason | null {
    const { frontierStop, departed, previousArrival, fix, recordedMs } = args;

    if (frontierStop !== null && !departed) {
      return 'awaiting-departure';
    }

    if (previousArrival !== null) {
      if (this.config.minInterStopMs > 0) {
        const previousMs = toMs(previousArrival.arrived_at);
        if (Number.isFinite(previousMs) && recordedMs - previousMs < this.config.minInterStopMs) {
          return 'inter-stop-cooldown';
        }
      }
      if (
        this.config.minInterStopDistanceMeters > 0 &&
        previousArrival.latitude != null &&
        previousArrival.longitude != null
      ) {
        const distance = haversineMeters(
          previousArrival.latitude,
          previousArrival.longitude,
          fix.latitude,
          fix.longitude,
        );
        if (distance !== null && distance < this.config.minInterStopDistanceMeters) {
          return 'inter-stop-distance';
        }
      }
    }

    return null;
  }

  private markSeen(tripId: string, stopId: string): void {
    const seen = this.seenByTrip.get(tripId) ?? new Set<string>();
    seen.add(stopId);
    this.seenByTrip.set(tripId, seen);
  }
  private insideForTrip(tripId: string): Map<string, StopInsideEvidence> {
    let inside = this.insideByTrip.get(tripId);
    if (!inside) {
      inside = new Map<string, StopInsideEvidence>();
      this.insideByTrip.set(tripId, inside);
    }
    return inside;
  }
  private emitToTrip(tripId: string, event: LiveTrackingEvent, payload: unknown): void {
    // Without an attached broadcaster (unit tests, gateway not yet up) the
    // event is simply dropped — persistence and the REST reads are unaffected.
    this.broadcaster?.(liveTrackingRoomName(tripId), event, payload);
  }
}

/** The structural stop surface the geofence evaluation needs. */
export interface GeofenceStop {
  id: string;
  name: string;
  sequence_number: number;
  is_active: boolean;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
}

/** The structural fix surface the eligibility gate needs. */
export interface EligibilityFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedMs: number;
}

/**
 * Phase 1 freshness/quality gate: separates historical ingestion (which
 * already happened — every accepted fix is persisted and stays in history)
 * from eligibility for a *live* alert.
 *
 * A fix is eligible only when ALL hold:
 *
 * - its original `recorded_at` is at most `maxFixAgeMs` old — old, replayed
 *   and out-of-order fixes (e.g. the newest fix of an offline batch uploaded
 *   hours later) never raise a current alert;
 * - it is not dated more than `futureToleranceMs` ahead of the server clock;
 * - its horizontal accuracy is within `maxAccuracyMeters`, or it carries no
 *   accuracy and `allowMissingAccuracy` is set;
 * - it is not an implausible jump from the last evaluated fix (implied speed
 *   above `maxPlausibleSpeedKmh` over at least `minJumpDistanceMeters`).
 *
 * Device heading, speed and receipt time play no role: heading is
 * meaningless when stationary, and receipt time says nothing about when the
 * bus was at the reported position.
 */
export function assessFixEligibility(
  fix: EligibilityFix,
  lastFix: LastFixReference | null,
  nowMs: number,
  config: Pick<
    ArrivalDetectionConfig,
    | 'maxFixAgeMs'
    | 'futureToleranceMs'
    | 'maxAccuracyMeters'
    | 'allowMissingAccuracy'
    | 'maxPlausibleSpeedKmh'
    | 'minJumpDistanceMeters'
  >,
): { eligible: boolean; reason: FixRejectionReason | null } {
  if (fix.recordedMs > nowMs + config.futureToleranceMs) {
    return { eligible: false, reason: 'future' };
  }
  if (nowMs - fix.recordedMs > config.maxFixAgeMs) {
    return { eligible: false, reason: 'stale' };
  }
  if (fix.accuracy === null || fix.accuracy === undefined) {
    if (!config.allowMissingAccuracy) {
      return { eligible: false, reason: 'missing-accuracy' };
    }
  } else if (!Number.isFinite(fix.accuracy) || fix.accuracy > config.maxAccuracyMeters) {
    return { eligible: false, reason: 'inaccurate' };
  }
  if (lastFix !== null && isImplausibleJump(fix, lastFix, config)) {
    return { eligible: false, reason: 'implausible-jump' };
  }
  return { eligible: true, reason: null };
}

/**
 * True when the fix implies teleportation from the last evaluated fix:
 * at least `minJumpDistanceMeters` away at an implied speed above
 * `maxPlausibleSpeedKmh`. Coinciding timestamps with a large displacement
 * count as a jump (a replay anomaly); small wander at any timestamp never
 * does, so stationary jitter cannot suppress arrivals.
 */
function isImplausibleJump(
  fix: Pick<EligibilityFix, 'latitude' | 'longitude' | 'recordedMs'>,
  lastFix: LastFixReference,
  config: Pick<ArrivalDetectionConfig, 'maxPlausibleSpeedKmh' | 'minJumpDistanceMeters'>,
): boolean {
  const distanceMeters = haversineMeters(
    lastFix.latitude,
    lastFix.longitude,
    fix.latitude,
    fix.longitude,
  );
  if (distanceMeters === null || distanceMeters < config.minJumpDistanceMeters) {
    return false;
  }
  const dtSeconds = (fix.recordedMs - lastFix.recordedMs) / 1000;
  if (dtSeconds <= 0) {
    return true;
  }
  const impliedKmh = (distanceMeters / dtSeconds) * 3.6;
  return impliedKmh > config.maxPlausibleSpeedKmh;
}

/**
 * The stop's EFFECTIVE geofence radius: the larger of the stored radius and
 * the configured floor (`ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS`, default 25).
 *
 * Every place a stop's radius participates — inside-evidence, the per-stop
 * accuracy gate, the departure-gate margin, candidate selection — must read
 * the radius through this helper so the floor is one rule, not four copies.
 * The stored radius stays the admin's intent; the floor is the runtime safety
 * net for legacy/small stops (deep-fix R1: a 10 m circle is smaller than a
 * phone's reported accuracy, so the "zone" behaved like a point).
 */
export function effectiveStopRadiusMeters(
  stop: Pick<GeofenceStop, 'geofence_radius_meters'>,
  config: Pick<ArrivalDetectionConfig, 'minEffectiveRadiusMeters'>,
): number {
  const stored = Number.isFinite(stop.geofence_radius_meters)
    ? Math.max(0, stop.geofence_radius_meters)
    : 0;
  const floor = Number.isFinite(config.minEffectiveRadiusMeters)
    ? Math.max(0, config.minEffectiveRadiusMeters)
    : 0;
  return Math.max(stored, floor);
}

/**
 * The accuracy a fix must reach before it can count toward a specific stop:
 * the tighter of the global `maxAccuracyMeters` ceiling and the stop's
 * EFFECTIVE geofence radius (`effectiveStopRadiusMeters`).
 *
 * Deep-fix R1 removed the old `radius / 2` divisor: a 10–30 m stop demanded
 * 5–15 m accuracy, which phones in urban/indoor conditions routinely fail
 * (10–30 m is normal), so a fix that WAS inside the circle was discarded as
 * evidence — the driver experienced an exact-coordinate point match. The
 * per-stop gate now only rejects a fix too coarse to localise inside the
 * effective circle at all; a stationary bus cascading through stops is
 * stopped by the departure gate, the dwell span and the inter-stop cooldown,
 * not by a tiny radius.
 *
 * A fix without an accuracy reading is only sufficient when
 * `allowMissingAccuracy` is set — an unknown accuracy cannot be trusted to
 * localise inside even a floored circle.
 */
export function fixAccuracySufficientForStop(
  accuracy: number | null | undefined,
  effectiveRadiusMeters: number,
  config: Pick<ArrivalDetectionConfig, 'maxAccuracyMeters' | 'allowMissingAccuracy'>,
): boolean {
  if (accuracy === null || accuracy === undefined) {
    return config.allowMissingAccuracy;
  }
  if (!Number.isFinite(accuracy)) {
    return false;
  }
  const allowed = Math.min(config.maxAccuracyMeters, effectiveRadiusMeters);
  return accuracy <= allowed;
}

/**
 * The geometry-aware half of the departure gate (deep-fix R2).
 *
 * A route can legally have consecutive stops closer than
 * `effectiveRadius + hysteresis` (70 m at the defaults): the stop editor's
 * spacing rule is `2 × the larger radius`, and at the legacy 10 m minimum
 * radius that allows stops 20–30 m apart. On such a route the bus standing
 * at stop N+1 is mathematically never outside stop N's circle, so the
 * classic "seen outside the geofence" departure can never fire while the bus
 * is doing exactly what the route asks of it. Without a second shape of
 * "moved on", stop N+1 stayed blocked for the whole dwell and then fell
 * behind the frontier silently — the "stop 2 was never announced" field
 * defect.
 *
 * This predicate supplies that second shape, and ONLY that shape: the fix is
 * inside a later (unarrived, recordable, ahead-of-frontier) stop's EFFECTIVE
 * circle **and strictly closer to that stop than to the frontier stop**.
 *
 * Why that is safe against the stationary cascade it exists alongside:
 *
 * - a bus parked AT the frontier stop is, by definition, closer to the
 *   frontier than to any later stop — GPS wander of ±3–6 m cannot flip the
 *   comparison on a 20+ m leg, and a tie counts as NOT moved on;
 * - being "moved on" only opens the departure gate. The stop still needs its
 *   own inside-evidence (2 consecutive fixes at production defaults), the
 *   10 s dwell span and the 30 s inter-stop cooldown before it records, so
 *   the gate cannot turn a wander spike into an arrival;
 * - after a later stop records it becomes the frontier, and the bus is again
 *   closest to the frontier — the cascade cannot chain.
 */
export function hasMovedOnTowardAheadStop(args: {
  fix: { latitude: number; longitude: number };
  frontierStop: GeofenceStop;
  routeStops: readonly GeofenceStop[];
  arrivedStopIds: ReadonlySet<string>;
  config: Pick<ArrivalDetectionConfig, 'minEffectiveRadiusMeters'>;
}): boolean {
  const { fix, frontierStop, routeStops, arrivedStopIds, config } = args;
  const distanceToFrontier = haversineMeters(
    fix.latitude,
    fix.longitude,
    frontierStop.latitude,
    frontierStop.longitude,
  );
  if (distanceToFrontier === null) {
    // An unsurveyed frontier cannot anchor the comparison; the caller's own
    // unsurveyed-frontier rule (do not hold) applies before this is reached.
    return false;
  }
  for (const stop of routeStops) {
    if (arrivedStopIds.has(stop.id)) continue;
    if (!isValidGeofenceStop(stop)) continue;
    if (stop.sequence_number <= frontierStop.sequence_number) continue;
    const distanceToStop = haversineMeters(fix.latitude, fix.longitude, stop.latitude, stop.longitude);
    if (distanceToStop === null) continue;
    if (
      distanceToStop < distanceToFrontier &&
      distanceToStop <= effectiveStopRadiusMeters(stop, config)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The active stops the progress frontier has moved PAST without an arrival
 * row — the stops this run will not serve (deep-fix R2).
 *
 * This is the derivation behind the `trip:stop:skipped` broadcast: for years
 * the geofence path dropped such stops silently ("the skip is final" — see
 * `selectProgressionCandidate`), so stop 2 could vanish from a run without a
 * word and the crew only found out from a parent. The skip itself stays
 * final — a passed stop is never recorded afterwards — but it is no longer
 * silent.
 *
 * Deliberately conservative about what counts as "passed":
 * - only stops BEHIND the frontier (`sequence_number < frontierSequence`) —
 *   the same monotonic rule the selector enforces;
 * - only stops with no arrival row at all. A crew-skip has a row (with its
 *   `skip_reason`), so it is already visible in every arrivals read and the
 *   tapping device speaks its own receipt — re-announcing it on the room
 *   would make one action speak twice;
 * - only ACTIVE stops — an inactive stop is not part of this run and
 *   announcing it would be a lie.
 *
 * Un-surveyed stops ARE included on purpose: the run really did pass them,
 * and their un-recordability is already warned about separately.
 */
export function stopsPassedByFrontier(
  stops: readonly GeofenceStop[],
  arrivalStopIds: ReadonlySet<string>,
  frontierSequence: number,
): GeofenceStop[] {
  const passed: GeofenceStop[] = [];
  for (const stop of stops) {
    if (stop.is_active === false) continue;
    if (arrivalStopIds.has(stop.id)) continue;
    if (!Number.isFinite(stop.sequence_number)) continue;
    if (stop.sequence_number >= frontierSequence) continue;
    passed.push(stop);
  }
  return passed.sort((a, b) => a.sequence_number - b.sequence_number);
}

/**
 * Advances the consecutive inside-geofence evidence for one evaluated fix.
 * Stops already arrived (or seen) are skipped and pruned; every other valid
 * stop moves to `count + 1` when the fix is inside its EFFECTIVE radius AND
 * precise enough for that stop, keeps its partial count inside the hysteresis
 * fringe (or when the fix is inside but too coarse to trust), and resets to
 * zero outside it. The effective radius (stored radius floored at
 * `ARRIVAL_MIN_EFFECTIVE_RADIUS_METERS`) is what makes the zone a circle a
 * parked bus can stand inside instead of a point it must hit.
 */
export function updateInsideEvidence(
  inside: Map<string, StopInsideEvidence>,
  routeStops: GeofenceStop[],
  arrivedStopIds: ReadonlySet<string>,
  seenStopIds: ReadonlySet<string> | undefined,
  fix: { latitude: number; longitude: number; accuracy?: number | null },
  recordedMs: number,
  exitHysteresisMeters: number,
  accuracyConfig: Pick<
    ArrivalDetectionConfig,
    'maxAccuracyMeters' | 'allowMissingAccuracy' | 'minEffectiveRadiusMeters'
  >,
): void {
  for (const stop of routeStops) {
    if (arrivedStopIds.has(stop.id) || seenStopIds?.has(stop.id)) {
      inside.delete(stop.id);
      continue;
    }
    if (!isValidGeofenceStop(stop)) {
      inside.delete(stop.id);
      continue;
    }
    const distance = haversineMeters(fix.latitude, fix.longitude, stop.latitude, stop.longitude);
    if (distance === null) {
      inside.set(stop.id, { count: 0, sinceMs: recordedMs });
      continue;
    }
    const radius = effectiveStopRadiusMeters(stop, accuracyConfig);
    if (distance <= radius) {
      if (!fixAccuracySufficientForStop(fix.accuracy ?? null, radius, accuracyConfig)) {
        // Inside the circle but too coarse to localise there: preserve any
        // existing evidence without adding to it, exactly like the fringe.
        if (!inside.has(stop.id)) {
          inside.set(stop.id, { count: 0, sinceMs: recordedMs });
        }
        continue;
      }
      const previous = inside.get(stop.id);
      inside.set(stop.id, {
        count: (previous?.count ?? 0) + 1,
        sinceMs: previous && previous.count > 0 ? previous.sinceMs : recordedMs,
      });
    } else if (distance <= radius + exitHysteresisMeters) {
      // Hysteresis fringe: edge jitter neither confirms nor wipes evidence.
      if (!inside.has(stop.id)) {
        inside.set(stop.id, { count: 0, sinceMs: recordedMs });
      }
    } else {
      inside.set(stop.id, { count: 0, sinceMs: recordedMs });
    }
  }
}

/** Input of the pure progression-candidate selection. */
export interface ProgressionCandidateInput {
  /** Route stops in any order; the selection sorts them. */
  stops: GeofenceStop[];
  arrivedStopIds: ReadonlySet<string>;
  seenStopIds: ReadonlySet<string> | undefined;
  /** Consecutive inside-geofence evidence accumulated so far. */
  inside: ReadonlyMap<string, StopInsideEvidence>;
  fix: { latitude: number; longitude: number; recordedMs: number };
  config: Pick<
    ArrivalDetectionConfig,
    | 'requiredConsecutiveFixes'
    | 'skipExtraFixes'
    | 'maxSkipAhead'
    | 'minDwellMs'
    | 'minEffectiveRadiusMeters'
  >;
}

/**
 * Confirmation tier of one stop: how many consecutive in-geofence fixes its
 * claim demands. The immediately next stop needs only the base count; each
 * stop skipped past the next one adds `skipExtraFixes`, and anything beyond
 * `maxSkipAhead` of the frontier needs one more (explicit re-sync). Shared by
 * the selection and the arrival diagnostics so the two can never disagree
 * about what a stop is waiting for.
 */
export function requiredFixesForProgression(
  sequenceNumber: number,
  frontier: number,
  nextUnarrivedSequence: number,
  config: Pick<
    ArrivalDetectionConfig,
    'requiredConsecutiveFixes' | 'skipExtraFixes' | 'maxSkipAhead'
  >,
): number {
  if (sequenceNumber <= nextUnarrivedSequence) {
    return config.requiredConsecutiveFixes;
  }
  let required = config.requiredConsecutiveFixes + config.skipExtraFixes;
  if (sequenceNumber > frontier + config.maxSkipAhead) {
    required += 1; // re-sync tier
  }
  return required;
}

/**
 * Phase 1 progression policy: the arrival candidate of one fix.
 *
 * Only stops AHEAD of the progress frontier (the highest sequence already
 * recorded) are ever eligible — a skipped stop behind the frontier is never
 * recorded afterwards (the skip is final; later stops proceed). The required
 * evidence escalates with distance from the next unarrived stop:
 *
 * - the next unarrived stop needs `requiredConsecutiveFixes` fixes;
 * - stops within `maxSkipAhead` beyond the frontier additionally need
 *   `skipExtraFixes` (a missed stop or two never blocks the trip, but
 *   out-of-order claims need stronger evidence);
 * - stops further ahead need one more fix on top (explicit re-sync after a
 *   detour, tunnel or mid-route join — extraordinary claims need
 *   extraordinary evidence).
 *
 * Every tier additionally honours the `minDwellMs` span when configured.
 * Among qualifying stops the ranking is: most consecutive evidence, then
 * nearest, then earliest in sequence — so overlapping geofences resolve to
 * the stop with sustained presence, not merely the lowest sequence number.
 * Exactly one stop can win per fix, so a single fix can never produce a
 * burst of arrival events.
 */
export function selectProgressionCandidate(
  input: ProgressionCandidateInput,
): { stop: GeofenceStop; distanceMeters: number } | null {
  const { arrivedStopIds, seenStopIds, inside, fix, config } = input;
  const recorded = (stopId: string): boolean =>
    arrivedStopIds.has(stopId) || (seenStopIds?.has(stopId) ?? false);

  const valid = input.stops
    .filter((stop) => !recorded(stop.id) && isValidGeofenceStop(stop))
    .sort((a, b) => a.sequence_number - b.sequence_number);
  if (valid.length === 0) {
    return null;
  }

  // Progress frontier: the highest sequence already recorded (0 before the
  // first arrival — the trip then anchors wherever confident evidence lands).
  let frontier = 0;
  for (const stop of input.stops) {
    if (recorded(stop.id) && Number.isFinite(stop.sequence_number)) {
      frontier = Math.max(frontier, stop.sequence_number);
    }
  }
  const nextUnarrived = valid.find((stop) => stop.sequence_number > frontier) ?? null;
  if (!nextUnarrived) {
    return null;
  }

  const ranked: Array<{ stop: GeofenceStop; distanceMeters: number; count: number }> = [];
  for (const stop of valid) {
    if (stop.sequence_number <= frontier) {
      continue; // behind the frontier: the skip is final
    }
    const distance = haversineMeters(fix.latitude, fix.longitude, stop.latitude, stop.longitude);
    // The effective (floored) radius is the circle the bus can stand inside —
    // the stored radius alone made small stops behave like points (R1).
    if (distance === null || distance > effectiveStopRadiusMeters(stop, config)) {
      continue;
    }
    const evidence = inside.get(stop.id);
    const count = evidence?.count ?? 0;
    const sinceMs = evidence?.sinceMs ?? fix.recordedMs;
    const required = requiredFixesForProgression(
      stop.sequence_number,
      frontier,
      nextUnarrived.sequence_number,
      config,
    );
    if (count < required) {
      continue;
    }
    if (config.minDwellMs > 0 && fix.recordedMs - sinceMs < config.minDwellMs) {
      continue;
    }
    ranked.push({ stop, distanceMeters: distance, count });
  }

  ranked.sort(
    (a, b) =>
      b.count - a.count ||
      a.distanceMeters - b.distanceMeters ||
      a.stop.sequence_number - b.stop.sequence_number,
  );
  const winner = ranked[0];
  return winner ? { stop: winner.stop, distanceMeters: winner.distanceMeters } : null;
}

/**
 * A stop can only match when it is active, surveyed and has a real radius.
 * Un-surveyed stops are silently non-matching here (nothing to geofence
 * against) — the explicit, warned treatment of that state lives in
 * `stopCoordinateWarnings` / `warnUnsurveyedStops`.
 */
function isValidGeofenceStop(stop: GeofenceStop): boolean {
  return isRecordableStop(stop);
}

/** True when the error is a Sequelize unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof UniqueConstraintError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'SequelizeUniqueConstraintError')
  );
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
