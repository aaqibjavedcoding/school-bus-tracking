import { Logger } from '../../framework';
import { UniqueConstraintError } from 'sequelize';
import {
  LIVE_TRACKING_EVENTS,
  TripProgressResponse,
  TripStopArrivalListResponse,
  TripStopArrivalResponse,
  TripStopArrivedEvent,
  TripEtaUpdateEvent,
  liveTrackingRoomName,
  type LiveTrackingEvent,
} from '@school-bus-tracking/shared-types';
import { getTripTrackingState, isTripTrackingActive } from '@school-bus-tracking/validation';
import { Stop, Trip, TripLocation, TripStopArrival } from '../../database/models';
import { NotificationsService } from '../notifications/notifications.service';
import { ETA_ARRIVALS_REPOSITORY, ETA_STOPS_REPOSITORY } from './eta.constants';
import { EtaService, type EtaLocationFix } from './eta.service';
import { haversineMeters } from './geo.util';

/** Room-scoped broadcast sink attached by the tracking gateway once sockets are up. */
export type EtaRoomBroadcaster = (room: string, event: LiveTrackingEvent, payload: unknown) => void;

/** One recorded arrival produced by evaluating an accepted GPS fix. */
export interface RecordedStopArrival {
  stop: { id: string; name: string; sequence_number: number };
  row: TripStopArrival;
  distanceMeters: number;
}

/**
 * Task 22 — stop arrival detection over the existing live-tracking pipeline.
 *
 * For every accepted *latest* GPS fix of an active trip (invoked by
 * `LiveTrackingService.recordLocation` after the fix is persisted and
 * broadcast) the service:
 *
 * 1. loads the trip's route stops, pinned to `(school_id, route_id)` — a fix
 *    of another trip/school can never be matched against them;
 * 2. computes the Haversine distance from the fix to each stop and keeps the
 *    candidates inside the stop's `geofence_radius_meters`;
 * 3. picks the earliest-in-sequence stop that has **not** recorded an
 *    arrival yet (in-memory per-process set + database unique index), so one
 *    trip-stop produces exactly one arrival event no matter how many fixes
 *    land inside the geofence;
 * 4. records the arrival row, broadcasts `trip:stop:arrived` to the trip's
 *    Socket.IO room (room membership is itself authorization-gated) and asks
 *    the Task 21 notifications service to notify the parents of children
 *    whose home stop was reached.
 *
 * The whole evaluation is best-effort: any failure is logged and swallowed,
 * and can never reject an otherwise accepted GPS fix.
 */
export class StopArrivalsService {
  private readonly logger = new Logger(StopArrivalsService.name);

  /** Broadcaster attached by the tracking gateway; `undefined` in unit tests. */
  private broadcaster: EtaRoomBroadcaster | undefined;

  /** Per-process stops already recorded for a trip (the DB index is the cross-process backstop). */
  private readonly seenByTrip = new Map<string, Set<string>>();

  constructor(
    private readonly stops: typeof Stop,
    private readonly arrivals: typeof TripStopArrival,
    private readonly eta: EtaService,
    private readonly notifications: NotificationsService,
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
   * Evaluates one accepted fix of an active trip: geofence detection,
   * arrival recording, arrival/ETA broadcasts and parent notification.
   * Best-effort by design — errors are logged, never re-thrown, so the
   * tracking pipeline stays unaffected.
   */
  async onAcceptedFix(trip: Trip, fix: TripLocation): Promise<RecordedStopArrival | null> {
    try {
      // Defence in depth: terminal trips never produce new arrivals, even if
      // a caller bypasses `recordLocation`'s own status gate.
      if (!isTripTrackingActive(trip.status)) {
        return null;
      }

      const routeStops = await this.loadRouteStops(trip);
      const existingArrivals = await this.loadArrivals(trip);
      const recorded = await this.recordCandidateArrival(trip, fix, routeStops, existingArrivals);

      // Recompute and broadcast the approximate ETA after every accepted
      // latest fix (and immediately after an arrival, so the next-stop state
      // advances in the same broadcast round).
      const etaResponse = await this.eta.computeTripEta({
        trip,
        latest: fix,
        stops: routeStops,
        arrivals: recorded ? [...existingArrivals, recorded.row] : existingArrivals,
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
   * next stop, all recorded arrivals and the ETA summary.
   */
  async getProgress(trip: Trip, latest: EtaLocationFix | null): Promise<TripProgressResponse> {
    const [stops, arrivals] = await Promise.all([
      this.loadRouteStops(trip),
      this.loadArrivals(trip),
    ]);
    const eta = await this.eta.computeTripEta({ trip, latest, stops, arrivals });
    return {
      trip_id: trip.id,
      school_id: trip.school_id,
      trip_status: trip.status,
      tracking_state: getTripTrackingState(trip.status),
      current_stop: eta.current_stop,
      next_stop: eta.next_stop,
      arrivals: this.mapArrivals(arrivals, stops),
      eta,
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Picks the earliest-in-sequence unarrived stop whose geofence contains
   * the fix and records exactly one arrival row for it. Duplicate protection
   * comes from the in-memory per-trip set, the existence check and — as the
   * cross-process backstop — the unique `(school_id, trip_id, stop_id)`
   * index (a racing insert is caught and treated as "already recorded").
   */
  private async recordCandidateArrival(
    trip: Trip,
    fix: TripLocation,
    routeStops: Stop[],
    existingArrivals: TripStopArrival[],
  ): Promise<RecordedStopArrival | null> {
    const arrivedStopIds = new Set(existingArrivals.map((arrival) => arrival.stop_id));
    const seen = this.seenByTrip.get(trip.id);
    const candidate = pickStopArrivalCandidate(routeStops, arrivedStopIds, seen, fix);
    if (!candidate) {
      return null;
    }

    // The candidate has coordinates by construction; the distance is real.
    const distanceMeters =
      haversineMeters(fix.latitude, fix.longitude, candidate.latitude, candidate.longitude) ?? 0;

    let row: TripStopArrival;
    try {
      row = await this.arrivals.create({
        school_id: trip.school_id,
        trip_id: trip.id,
        stop_id: candidate.id,
        arrived_at: new Date(),
        latitude: fix.latitude,
        longitude: fix.longitude,
        distance_meters: distanceMeters,
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

    // Best-effort parent notification (deduplicated inside the Task 21
    // service on trip + stop + type); never affects the arrival itself.
    await this.notifications.notifyStopArrival({
      school_id: trip.school_id,
      trip_id: trip.id,
      stop: { id: candidate.id, name: candidate.name },
      occurred_at: new Date(row.arrived_at),
    });

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

/**
 * The arrival candidate of one fix: the earliest-in-sequence stop of the
 * trip's route that (a) is active and has coordinates and a positive geofence
 * radius, (b) has no recorded arrival yet and (c) contains the fix inside its
 * geofence. Exactly one stop can win per fix, so a single fix can never
 * produce a burst of arrival events.
 */
export function pickStopArrivalCandidate(
  routeStops: GeofenceStop[],
  arrivedStopIds: ReadonlySet<string>,
  seenStopIds: ReadonlySet<string> | undefined,
  fix: { latitude: number; longitude: number },
): GeofenceStop | null {
  const candidates = routeStops
    .filter((stop) => {
      if (arrivedStopIds.has(stop.id) || seenStopIds?.has(stop.id)) {
        return false;
      }
      if (
        stop.is_active === false ||
        stop.latitude == null ||
        stop.longitude == null ||
        !Number.isFinite(stop.geofence_radius_meters) ||
        stop.geofence_radius_meters <= 0
      ) {
        return false;
      }
      const distance = haversineMeters(fix.latitude, fix.longitude, stop.latitude, stop.longitude);
      return distance !== null && distance <= stop.geofence_radius_meters;
    })
    .sort((a, b) => a.sequence_number - b.sequence_number);

  return candidates[0] ?? null;
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
