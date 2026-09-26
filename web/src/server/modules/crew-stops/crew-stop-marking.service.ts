import { ConflictException, NotFoundException } from '../../framework';
import {
  RouteAssignmentRole,
  UserRole,
  type TripStopArrivalResponse,
  type TripStopCrewMarkResponse,
} from '@school-bus-tracking/shared-types';
import { isTripOpenForCrewStopMarking } from '@school-bus-tracking/validation';
import { RouteAssignment, Stop, Student, Trip, TripStopArrival } from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import type { StopArrivalsService } from '../eta/stop-arrivals.service';
import {
  CREW_STOPS_STOP_NOT_ON_TRIP_MESSAGE,
  CREW_STOPS_TRIP_CLOSED_MESSAGE,
  CREW_STOPS_TRIP_NOT_FOUND_MESSAGE,
} from './crew-stops.constants';

/**
 * Crew stop marking — "we were here" and "we passed this one", by hand.
 *
 * ### Why it exists
 *
 * A stop used to become "reached" in exactly one way: the GPS pipeline
 * matched an accepted fix against the stop's 100 m geofence. That is the
 * right default and stays the default — but it fails in the field in ways the
 * crew cannot fix from the driver's seat: location permission revoked by a
 * battery optimiser, a phone with no sky view, an urban canyon, a bus parked
 * across the road. When it fails the run **sticks**: `next_stop` never
 * advances, the kids card keeps showing a stop already served, and the
 * parents of later stops get no alerts at all. Until now the crew could only
 * watch that happen. These two endpoints give them the pen.
 *
 * ### The rules, and why each one
 *
 * - **crew of this trip only** (`DRIVER` / `CONDUCTOR`). This is testimony
 *   about where a bus physically was; only the people on it can give it. A
 *   `SCHOOL_ADMIN` is deliberately *not* allowed — an admin at a desk marking
 *   a stop "arrived" would put a fact into the record that nobody witnessed,
 *   and admin corrections are a different feature with a different audit
 *   story. Membership is proven server-side, either by the trip's own
 *   dispatch snapshot or by an active `RouteAssignment` effective on the trip
 *   date — exactly the rule `TripAttendanceService` already applies, because
 *   "am I the crew of this trip?" must not have two answers.
 * - **open trips only**. A `COMPLETED` / `CANCELLED` run's stop record is an
 *   audit artefact (`isTripOpenForCrewStopMarking`, the attendance window).
 * - **the stop must be on this trip's route**, resolved through the trip —
 *   never from the client's id alone — so no cross-route or cross-tenant stop
 *   can be attached to a run.
 * - **idempotent**. The write itself dedupes on `(school_id, trip_id,
 *   stop_id)`: a stop already recorded (by the geofence, or by a replay of
 *   the same offline-queue item) answers `200` with the existing row and
 *   `created: false`. An offline queue that retries must never produce a
 *   second arrival, and must never look like a failure to the crew.
 *
 * Everything a caller may not see collapses into the same generic `404` as a
 * non-existent record, so probing cannot confirm a trip or stop exists.
 */
export class CrewStopMarkingService {
  constructor(
    private readonly trips: typeof Trip,
    private readonly stops: typeof Stop,
    private readonly students: typeof Student,
    private readonly assignments: typeof RouteAssignment,
    private readonly stopArrivals: StopArrivalsService,
  ) {}

  /**
   * `POST /api/v1/trips/:tripId/stops/:stopId/arrive`
   *
   * Records the stop as reached on the crew's word. Parents of that stop are
   * notified exactly as they are for a geofence arrival — the bus really did
   * serve the stop; only the evidence differs.
   */
  async markArrived(
    actor: AuthenticatedRequestUser,
    tripId: string,
    stopId: string,
  ): Promise<TripStopCrewMarkResponse> {
    return this.mark(actor, tripId, stopId, null);
  }

  /**
   * `POST /api/v1/trips/:tripId/stops/:stopId/skip`
   *
   * Records that the run passed the stop **without serving it**, with the
   * crew's reason. No parent notification is sent: nobody's child was picked
   * up or dropped, and "your stop was reached" would be false. The school
   * sees it on the trip detail, because the row is in the same arrivals read
   * the detail already renders — carrying its `skip_reason`.
   */
  async markSkipped(
    actor: AuthenticatedRequestUser,
    tripId: string,
    stopId: string,
    reason: string,
  ): Promise<TripStopCrewMarkResponse> {
    return this.mark(actor, tripId, stopId, reason.trim());
  }

  /** The shared body of both endpoints; `skipReason === null` means arrived. */
  private async mark(
    actor: AuthenticatedRequestUser,
    tripId: string,
    stopId: string,
    skipReason: string | null,
  ): Promise<TripStopCrewMarkResponse> {
    const trip = await this.resolveTripForCrew(actor, tripId);
    assertTripOpen(trip);
    const stop = await this.resolveStopOnTrip(trip, stopId);

    const { row, created } = await this.stopArrivals.recordCrewStopMark({
      trip,
      stop: { id: stop.id, name: stop.name, sequence_number: stop.sequence_number },
      actorUserId: actor.id,
      skipReason,
    });

    return {
      arrival: this.toArrivalResponse(row, stop),
      stop_sequence_number: stop.sequence_number,
      students_expected: await this.countStudentsAtStop(trip, stop),
      created,
    };
  }

  /**
   * Resolves the trip inside the caller's tenant and proves the caller crews
   * it. Unknown id, another tenant's trip and "not my trip" are one `404`.
   */
  private async resolveTripForCrew(actor: AuthenticatedRequestUser, tripId: string): Promise<Trip> {
    const trip = await this.trips.findOne({
      where: { id: tripId, school_id: actor.school_id },
    });
    if (!trip) {
      throw new NotFoundException(CREW_STOPS_TRIP_NOT_FOUND_MESSAGE);
    }

    // The route guard already restricts the endpoint to DRIVER/CONDUCTOR;
    // this is the second half of the answer — *which* trips those are.
    if (actor.role !== UserRole.DRIVER && actor.role !== UserRole.CONDUCTOR) {
      throw new NotFoundException(CREW_STOPS_TRIP_NOT_FOUND_MESSAGE);
    }

    // The dispatch snapshot on the trip is itself derived from an active
    // roster row at dispatch time, so it is accepted directly.
    if (actor.id === trip.driver_id || actor.id === trip.conductor_id) {
      return trip;
    }

    const role =
      actor.role === UserRole.DRIVER ? RouteAssignmentRole.DRIVER : RouteAssignmentRole.CONDUCTOR;
    const candidates = await this.assignments.findAll({
      where: {
        school_id: actor.school_id,
        route_id: trip.route_id,
        user_id: actor.id,
        role,
        is_active: true,
      },
    });

    const tripDate = toDateOnly(trip.scheduled_start_at);
    if (!candidates.some((candidate) => coversDate(candidate, tripDate))) {
      throw new NotFoundException(CREW_STOPS_TRIP_NOT_FOUND_MESSAGE);
    }
    return trip;
  }

  /**
   * Resolves the stop **through the trip**: same tenant, same route. A stop
   * of another route, another school or no route at all is one `404`.
   *
   * An inactive stop is still markable: the run in progress was planned with
   * it, and deactivating a stop mid-day must not strand the crew.
   */
  private async resolveStopOnTrip(trip: Trip, stopId: string): Promise<Stop> {
    const stop = await this.stops.findOne({
      where: { id: stopId, school_id: trip.school_id, route_id: trip.route_id },
    });
    if (!stop) {
      throw new NotFoundException(CREW_STOPS_STOP_NOT_ON_TRIP_MESSAGE);
    }
    return stop;
  }

  /**
   * How many active children call this stop home — the number the crew's
   * spoken confirmation says out loud ("Stop 3 recorded, 5 children board
   * here"). Read from the server so the announcement cannot repeat a stale
   * manifest slice the phone happened to be holding.
   */
  private async countStudentsAtStop(trip: Trip, stop: Stop): Promise<number> {
    return this.students.count({
      where: { school_id: trip.school_id, home_stop_id: stop.id, is_active: true },
    });
  }

  /**
   * Explicit projection — the same shape `GET /trips/:tripId/arrivals`
   * returns, so a client never has to special-case where a row came from.
   */
  private toArrivalResponse(row: TripStopArrival, stop: Stop): TripStopArrivalResponse {
    return {
      id: row.id,
      school_id: row.school_id,
      trip_id: row.trip_id,
      stop_id: row.stop_id,
      stop_name: stop.name,
      arrived_at: toIsoString(row.arrived_at),
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      distance_meters: row.distance_meters ?? null,
      source: row.source ?? 'geofence',
      skip_reason: row.skip_reason ?? null,
      recorded_by: row.recorded_by ?? null,
      created_at: toIsoString(row.created_at),
    };
  }
}

/** A closed run's stop record is an audit artefact; it does not change. */
function assertTripOpen(trip: Trip): void {
  if (!isTripOpenForCrewStopMarking(trip.status)) {
    throw new ConflictException(CREW_STOPS_TRIP_CLOSED_MESSAGE);
  }
}

/** Roster periods are tenant-local dates compared on the trip's UTC day. */
function toDateOnly(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function coversDate(assignment: RouteAssignment, date: string): boolean {
  const from = normalizeDateOnly(assignment.effective_from);
  const to = assignment.effective_to == null ? null : normalizeDateOnly(assignment.effective_to);
  return from <= date && (to === null || date <= to);
}

function normalizeDateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
