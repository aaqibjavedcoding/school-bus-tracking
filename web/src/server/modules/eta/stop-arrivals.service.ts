import { Logger } from '../../framework';
import { UniqueConstraintError, type Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import {
  LIVE_TRACKING_EVENTS,
  TripArrivalDiagnostics,
  TripArrivalFixRejection,
  TripArrivalPendingStop,
  TripProgressResponse,
  TripStopArrivalListResponse,
  TripStopArrivalResponse,
  TripStopArrivedEvent,
  TripStopWarning,
  TripEtaUpdateEvent,
  liveTrackingRoomName,
  type LiveTrackingEvent,
} from '@school-bus-tracking/shared-types';
import { getTripTrackingState, isTripTrackingActive } from '@school-bus-tracking/validation';
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
   * In-a-row fixes inside a geofence before a stop records. The immediately
   * next stop defaults to 1 (see `DEFAULT_ARRIVAL_DETECTION_CONFIG`): its
   * evidence must survive real GPS jitter, or the trip sticks at the first
   * stop. Escalating tiers below still demand consecutive runs for the
   * extraordinary claims (skipped-ahead, re-sync).
   */
  requiredConsecutiveFixes: number;
  /** Extra consecutive fixes for a stop ahead of the next unarrived stop. */
  skipExtraFixes: number;
  /** Tier boundary: stops further beyond the frontier need re-sync evidence. */
  maxSkipAhead: number;
  /** Fringe band past the geofence edge preserving partial evidence. */
  exitHysteresisMeters: number;
  /** Minimum span between first and confirming inside-fix (0 = disabled). */
  minDwellMs: number;
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
  allowMissingAccuracy: true,
  // The next unarrived stop records from a SINGLE eligible in-geofence fix.
  // Requiring strictly-consecutive inside fixes made confirmation the weakest
  // link of the trip: one edge-jitter fix outside the radius reset the run and
  // the trip read "stuck at first" with no explanation (the sim drove one fix
  // per stop visit and recorded nothing). The eligibility gate above is the
  // anti-jitter gate; out-of-order claims keep the escalating consecutive
  // tiers (`skipExtraFixes`, `maxSkipAhead`).
  requiredConsecutiveFixes: 1,
  skipExtraFixes: 1,
  maxSkipAhead: 2,
  exitHysteresisMeters: 20,
  minDwellMs: 0,
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

  /** Trips whose un-surveyed stops were already warned about (once per process). */
  private readonly warnedByTrip = new Map<string, Set<string>>();

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
      // Defence in depth: terminal trips never produce new arrivals, even if
      // a caller bypasses `recordLocation`'s own status gate.
      if (!isTripTrackingActive(trip.status)) {
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

  /** Drops the per-process arrival memory once a trip becomes terminal. */
  resetForTrip(tripId: string): void {
    this.seenByTrip.delete(tripId);
    this.lastFixByTrip.delete(tripId);
    this.insideByTrip.delete(tripId);
    this.lastRejectionByTrip.delete(tripId);
    this.warnedByTrip.delete(tripId);
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
   * stops, per-stop evidence against its confirmation tier, and the reason
   * the newest evaluated fix produced nothing. Pure composition of state the
   * evaluator already keeps — never another source of truth.
   */
  private buildArrivalDiagnostics(
    trip: Trip,
    stops: Stop[],
    arrivals: TripStopArrival[],
  ): TripArrivalDiagnostics {
    const unsurveyedStops: TripStopWarning[] = stopCoordinateWarnings(stops);
    this.warnUnsurveyedStops(trip.id, unsurveyedStops);

    const arrivedIds = new Set(arrivals.map((arrival) => arrival.stop_id));
    let frontier = 0;
    for (const stop of stops) {
      if (arrivedIds.has(stop.id) && stop.sequence_number > frontier) {
        frontier = stop.sequence_number;
      }
    }
    const nextUnarrived = [...stops]
      .filter((stop) => !arrivedIds.has(stop.id) && isValidGeofenceStop(stop))
      .sort((a, b) => a.sequence_number - b.sequence_number)[0];

    const inside = this.insideByTrip.get(trip.id) ?? new Map<string, StopInsideEvidence>();
    const pending_stops: TripArrivalPendingStop[] = stops
      .filter(
        (stop) => !arrivedIds.has(stop.id) && stop.sequence_number > frontier && isValidGeofenceStop(stop),
      )
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .map((stop) => ({
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
      }));

    return {
      last_fix_rejection: this.lastRejectionByTrip.get(trip.id) ?? null,
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

    const arrivedStopIds = new Set(existingArrivals.map((arrival) => arrival.stop_id));
    const seen = this.seenByTrip.get(trip.id);
    const inside = this.insideForTrip(trip.id);
    updateInsideEvidence(
      inside,
      routeStops,
      arrivedStopIds,
      seen,
      { latitude: fix.latitude, longitude: fix.longitude },
      recordedMs,
      this.config.exitHysteresisMeters,
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
      latitude: row.latitude,
      longitude: row.longitude,
      distance_meters: row.distance_meters,
    };
    this.emitToTrip(trip.id, LIVE_TRACKING_EVENTS.stopArrived, event);

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
      latitude: arrival.latitude,
      longitude: arrival.longitude,
      distance_meters: arrival.distance_meters,
      created_at: toIsoString(arrival.created_at),
    }));
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
 * Advances the consecutive inside-geofence evidence for one evaluated fix.
 * Stops already arrived (or seen) are skipped and pruned; every other valid
 * stop moves to `count + 1` when the fix is inside its radius, keeps its
 * partial count inside the hysteresis fringe, and resets to zero outside it.
 */
export function updateInsideEvidence(
  inside: Map<string, StopInsideEvidence>,
  routeStops: GeofenceStop[],
  arrivedStopIds: ReadonlySet<string>,
  seenStopIds: ReadonlySet<string> | undefined,
  fix: { latitude: number; longitude: number },
  recordedMs: number,
  exitHysteresisMeters: number,
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
    if (distance <= stop.geofence_radius_meters) {
      const previous = inside.get(stop.id);
      inside.set(stop.id, {
        count: (previous?.count ?? 0) + 1,
        sinceMs: previous && previous.count > 0 ? previous.sinceMs : recordedMs,
      });
    } else if (distance <= stop.geofence_radius_meters + exitHysteresisMeters) {
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
    'requiredConsecutiveFixes' | 'skipExtraFixes' | 'maxSkipAhead' | 'minDwellMs'
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
    if (distance === null || distance > stop.geofence_radius_meters) {
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
