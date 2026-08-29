import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import {
  RouteAssignmentRole,
  TripAttendanceStatus,
  TripStudentAttendanceResponse,
  TripStudentManifestResponse,
  TripStudentManifestSummary,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { isTripOpenForAttendance } from '@school-bus-tracking/validation';
import {
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripStudentAttendance,
} from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import {
  TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE,
  TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE,
  TRIP_ATTENDANCE_GUARDIANS_REPOSITORY,
  TRIP_ATTENDANCE_NO_SEQUELIZE_MESSAGE,
  TRIP_ATTENDANCE_NOT_BOARDED_MESSAGE,
  TRIP_ATTENDANCE_REPOSITORY,
  TRIP_ATTENDANCE_ROUTE_ASSIGNMENTS_REPOSITORY,
  TRIP_ATTENDANCE_STOPS_REPOSITORY,
  TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE,
  TRIP_ATTENDANCE_STUDENTS_REPOSITORY,
  TRIP_ATTENDANCE_TRIP_CLOSED_MESSAGE,
  TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE,
  TRIP_ATTENDANCE_TRIPS_REPOSITORY,
} from './trip-attendance.constants';
import { ListTripStudentsQueryDto } from './dto/list-trip-students-query.dto';
import {
  NotificationsService,
  type StudentAttendanceNotificationInput,
} from '../notifications/notifications.service';

/** A student together with the route stop that puts them on the manifest. */
interface ManifestSeat {
  student: Student;
  stop: Stop;
}

/**
 * Tenant-safe trip student attendance (boarding / drop management).
 *
 * The manifest is **derived, never trusted**: from the trip (resolved with the
 * JWT tenant) the service takes the route, from the route its ordered stops,
 * and from those stops the active students whose home stop sits on them. A
 * client therefore cannot inject a school, route, stop or student that does
 * not already belong to the trip.
 *
 * Access is decided per role:
 * - `SCHOOL_ADMIN` — any trip of their own school (oversight and corrections);
 * - `DRIVER` / `CONDUCTOR` — only trips they actually crew, proven either by
 *   the trip's own dispatch snapshot or by an **active** `RouteAssignment`
 *   for that route, in their own operational role, effective on the trip date;
 * - `PARENT` — read-only, and only the children they are actively linked to
 *   through `StudentGuardian`.
 *
 * Anything a caller may not see produces the same generic `404` as a
 * non-existent record, so cross-tenant or cross-trip probing cannot confirm
 * that a resource exists.
 */
@Injectable()
export class TripAttendanceService {
  constructor(
    @Inject(TRIP_ATTENDANCE_REPOSITORY)
    private readonly attendance: typeof TripStudentAttendance,
    @Inject(TRIP_ATTENDANCE_TRIPS_REPOSITORY)
    private readonly trips: typeof Trip,
    @Inject(TRIP_ATTENDANCE_STOPS_REPOSITORY)
    private readonly stops: typeof Stop,
    @Inject(TRIP_ATTENDANCE_STUDENTS_REPOSITORY)
    private readonly students: typeof Student,
    @Inject(TRIP_ATTENDANCE_GUARDIANS_REPOSITORY)
    private readonly guardians: typeof StudentGuardian,
    @Inject(TRIP_ATTENDANCE_ROUTE_ASSIGNMENTS_REPOSITORY)
    private readonly assignments: typeof RouteAssignment,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * `GET /api/v1/trips/:tripId/students`
   *
   * Ordered manifest of the trip. Entries come back sorted by route stop
   * sequence and then by student name, so consecutive entries sharing a
   * `stop_id` form that stop's boarding group.
   */
  async getManifest(
    actor: AuthenticatedRequestUser,
    tripId: string,
    query: ListTripStudentsQueryDto = {},
  ): Promise<TripStudentManifestResponse> {
    const trip = await this.resolveTripForActor(actor, tripId);
    const seats = await this.loadVisibleSeats(actor, trip);

    // A parent with no linked child on this run learns nothing about it.
    if (actor.role === UserRole.PARENT && seats.length === 0) {
      throw new NotFoundException(TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE);
    }

    const rows = await this.attendance.findAll({
      where: { school_id: actor.school_id, trip_id: trip.id },
    });
    const rowsByStudent = new Map(rows.map((row) => [row.student_id, row]));

    const entries = seats
      .filter((seat) => query.stop_id === undefined || seat.stop.id === query.stop_id)
      .map((seat) => this.toResponse(trip, seat, rowsByStudent.get(seat.student.id) ?? null));

    const summary = summarise(entries);
    const items =
      query.status === undefined
        ? entries
        : entries.filter((entry) => entry.status === query.status);

    return {
      trip_id: trip.id,
      school_id: trip.school_id,
      route_id: trip.route_id,
      trip_status: trip.status,
      items,
      summary,
    };
  }

  /**
   * `GET /api/v1/trips/:tripId/students/:studentId`
   *
   * Single manifest entry — the view a parent polls for their own child.
   */
  async getStudent(
    actor: AuthenticatedRequestUser,
    tripId: string,
    studentId: string,
  ): Promise<TripStudentAttendanceResponse> {
    const trip = await this.resolveTripForActor(actor, tripId);
    const seat = await this.resolveSeat(actor, trip, studentId);
    const row = await this.attendance.findOne({
      where: { school_id: actor.school_id, trip_id: trip.id, student_id: seat.student.id },
    });
    return this.toResponse(trip, seat, row);
  }

  /**
   * `POST /api/v1/trips/:tripId/students/:studentId/board`
   *
   * Records the boarding with the server clock and the JWT subject. The write
   * runs inside a transaction and the partial unique index on
   * `(school_id, trip_id, student_id)` turns a concurrent second request from
   * another crew device into the same `409` as a sequential duplicate.
   */
  async board(
    actor: AuthenticatedRequestUser,
    tripId: string,
    studentId: string,
  ): Promise<TripStudentAttendanceResponse> {
    const trip = await this.resolveTripForActor(actor, tripId);
    assertTripOpen(trip);
    const seat = await this.resolveSeat(actor, trip, studentId);

    const response = await this.inTransaction(async (transaction) => {
      const existing = await this.findRowForUpdate(actor.school_id, trip.id, seat, transaction);

      if (existing !== null && existing.status === TripAttendanceStatus.BOARDED) {
        throw new ConflictException(TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE);
      }
      if (existing !== null && existing.status === TripAttendanceStatus.DROPPED) {
        throw new ConflictException(TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE);
      }

      const values = {
        stop_id: seat.stop.id,
        status: TripAttendanceStatus.BOARDED,
        boarded_at: new Date(),
        boarded_by: actor.id,
        dropped_at: null,
        dropped_by: null,
      };

      if (existing !== null) {
        await existing.update(values, { transaction });
        return this.toResponse(trip, seat, existing);
      }

      try {
        const created = await this.attendance.create(
          {
            school_id: actor.school_id,
            trip_id: trip.id,
            student_id: seat.student.id,
            ...values,
          },
          { transaction },
        );
        return this.toResponse(trip, seat, created);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new ConflictException(TRIP_ATTENDANCE_ALREADY_BOARDED_MESSAGE);
        }
        throw error;
      }
    });

    // Only a committed boarding notifies the parents — and a notification
    // failure never rolls the attendance back (the service is best-effort).
    await this.notifyParents(
      actor,
      trip,
      seat,
      response,
      'boarded',
      response.boarded_at ? new Date(response.boarded_at) : new Date(),
    );
    return response;
  }

  /**
   * `POST /api/v1/trips/:tripId/students/:studentId/drop`
   *
   * Closes the student's leg of the trip. A student who never boarded (or who
   * was already dropped) is rejected with `409` instead of silently creating a
   * half-recorded attendance row.
   */
  async drop(
    actor: AuthenticatedRequestUser,
    tripId: string,
    studentId: string,
  ): Promise<TripStudentAttendanceResponse> {
    const trip = await this.resolveTripForActor(actor, tripId);
    assertTripOpen(trip);
    const seat = await this.resolveSeat(actor, trip, studentId);

    const response = await this.inTransaction(async (transaction) => {
      const existing = await this.findRowForUpdate(actor.school_id, trip.id, seat, transaction);

      if (existing === null || existing.status === TripAttendanceStatus.PENDING) {
        throw new ConflictException(TRIP_ATTENDANCE_NOT_BOARDED_MESSAGE);
      }
      if (existing.status === TripAttendanceStatus.DROPPED) {
        throw new ConflictException(TRIP_ATTENDANCE_ALREADY_DROPPED_MESSAGE);
      }

      await existing.update(
        {
          status: TripAttendanceStatus.DROPPED,
          dropped_at: new Date(),
          dropped_by: actor.id,
        },
        { transaction },
      );

      return this.toResponse(trip, seat, existing);
    });

    // Only a committed drop notifies the parents; failures never undo the
    // attendance record itself.
    await this.notifyParents(
      actor,
      trip,
      seat,
      response,
      'dropped',
      response.dropped_at ? new Date(response.dropped_at) : new Date(),
    );
    return response;
  }

  /**
   * Fires the parent notification for a **successful** attendance event.
   *
   * Called strictly after the attendance transaction has committed, so a
   * rejected or failed board/drop can never produce a notification. The
   * notifications service is best-effort: it logs and swallows its own
   * failures, so a notification outage can never break attendance recording.
   */
  private async notifyParents(
    actor: AuthenticatedRequestUser,
    trip: Trip,
    seat: ManifestSeat,
    response: TripStudentAttendanceResponse,
    action: StudentAttendanceNotificationInput['action'],
    occurredAt: Date,
  ): Promise<void> {
    await this.notifications.notifyStudentAttendance({
      school_id: actor.school_id,
      trip_id: trip.id,
      student: {
        id: seat.student.id,
        first_name: response.first_name,
        last_name: response.last_name,
      },
      action,
      occurred_at: occurredAt,
    });
  }

  /**
   * Resolves the trip inside the caller's tenant and authorises the caller
   * for it. Every failure mode collapses into the same generic `404`.
   */
  private async resolveTripForActor(
    actor: AuthenticatedRequestUser,
    tripId: string,
  ): Promise<Trip> {
    const trip = await this.trips.findOne({
      where: { id: tripId, school_id: actor.school_id },
    });
    if (!trip) {
      throw new NotFoundException(TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE);
    }

    if (actor.role === UserRole.DRIVER || actor.role === UserRole.CONDUCTOR) {
      await this.assertCrewOfTrip(actor, trip);
    }

    return trip;
  }

  /**
   * Crew authorisation.
   *
   * The dispatch snapshot on the trip (`driver_id` / `conductor_id`) is itself
   * derived from an active roster row at dispatch time, so it is accepted
   * directly; otherwise the caller must hold an active `RouteAssignment` for
   * this route, in the operational role matching their account role, that is
   * effective on the trip's calendar day. Both paths are server-derived — no
   * client input takes part in the decision.
   */
  private async assertCrewOfTrip(actor: AuthenticatedRequestUser, trip: Trip): Promise<void> {
    if (actor.id === trip.driver_id || actor.id === trip.conductor_id) {
      return;
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
      throw new NotFoundException(TRIP_ATTENDANCE_TRIP_NOT_FOUND_MESSAGE);
    }
  }

  /**
   * Builds the manifest seats the caller is allowed to see: every active
   * student whose home stop belongs to the trip's route, narrowed to the
   * caller's own children when the caller is a parent.
   */
  private async loadVisibleSeats(
    actor: AuthenticatedRequestUser,
    trip: Trip,
  ): Promise<ManifestSeat[]> {
    const stops = await this.stops.findAll({
      where: { school_id: actor.school_id, route_id: trip.route_id },
    });
    if (stops.length === 0) {
      return [];
    }

    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
    const students = await this.students.findAll({
      where: {
        school_id: actor.school_id,
        home_stop_id: { [Op.in]: [...stopsById.keys()] },
        is_active: true,
      },
    });

    const visible =
      actor.role === UserRole.PARENT ? await this.filterToOwnChildren(actor, students) : students;

    const seats: ManifestSeat[] = [];
    for (const student of visible) {
      const stop = student.home_stop_id === null ? undefined : stopsById.get(student.home_stop_id);
      if (stop) {
        seats.push({ student, stop });
      }
    }

    return seats.sort(compareSeats);
  }

  /** Restricts a student list to the parent's active guardian relationships. */
  private async filterToOwnChildren(
    actor: AuthenticatedRequestUser,
    students: Student[],
  ): Promise<Student[]> {
    if (students.length === 0) {
      return [];
    }

    const links = await this.guardians.findAll({
      where: { school_id: actor.school_id, user_id: actor.id, is_active: true },
    });
    const ownStudentIds = new Set(links.map((link) => link.student_id));
    return students.filter((student) => ownStudentIds.has(student.id));
  }

  /**
   * Resolves one student to their seat on the trip's manifest.
   *
   * A student of another tenant, an inactive student, a student without a home
   * stop, a student whose stop belongs to a different route and — for a parent
   * — somebody else's child are all indistinguishable from the outside.
   */
  private async resolveSeat(
    actor: AuthenticatedRequestUser,
    trip: Trip,
    studentId: string,
  ): Promise<ManifestSeat> {
    const student = await this.students.findOne({
      where: { id: studentId, school_id: actor.school_id },
    });
    if (!student || student.is_active === false || student.home_stop_id === null) {
      throw new NotFoundException(TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE);
    }

    const stop = await this.stops.findOne({
      where: {
        id: student.home_stop_id,
        school_id: actor.school_id,
        route_id: trip.route_id,
      },
    });
    if (!stop) {
      throw new NotFoundException(TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE);
    }

    if (actor.role === UserRole.PARENT) {
      const own = await this.filterToOwnChildren(actor, [student]);
      if (own.length === 0) {
        throw new NotFoundException(TRIP_ATTENDANCE_STUDENT_NOT_ON_TRIP_MESSAGE);
      }
    }

    return { student, stop };
  }

  /** Reads the current attendance row with a row-level lock when possible. */
  private async findRowForUpdate(
    schoolId: string,
    tripId: string,
    seat: ManifestSeat,
    transaction: Transaction | undefined,
  ): Promise<TripStudentAttendance | null> {
    return this.attendance.findOne({
      where: { school_id: schoolId, trip_id: tripId, student_id: seat.student.id },
      transaction,
      lock: transaction ? Transaction.LOCK.UPDATE : undefined,
    });
  }

  /** Runs a write through the model's Sequelize instance transactionally. */
  private async inTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    const sequelize = this.attendance.sequelize;
    if (!sequelize) {
      throw new InternalServerErrorException(TRIP_ATTENDANCE_NO_SEQUELIZE_MESSAGE);
    }
    return sequelize.transaction(async (transaction) => work(transaction));
  }

  /**
   * Explicit projection — ORM internals, associations and any column of the
   * joined user records (password or refresh-token hashes above all) can never
   * leak into a response.
   */
  private toResponse(
    trip: Trip,
    seat: ManifestSeat,
    row: TripStudentAttendance | null,
  ): TripStudentAttendanceResponse {
    return {
      id: row?.id ?? null,
      school_id: trip.school_id,
      trip_id: trip.id,
      student_id: seat.student.id,
      admission_number: seat.student.admission_number,
      first_name: seat.student.first_name,
      last_name: seat.student.last_name,
      grade_level: seat.student.grade_level ?? null,
      stop_id: seat.stop.id,
      stop_name: seat.stop.name,
      stop_sequence_number: seat.stop.sequence_number,
      status: row?.status ?? TripAttendanceStatus.PENDING,
      boarded_at: toNullableIsoString(row?.boarded_at),
      boarded_by: row?.boarded_by ?? null,
      dropped_at: toNullableIsoString(row?.dropped_at),
      dropped_by: row?.dropped_by ?? null,
      created_at: toNullableIsoString(row?.created_at),
      updated_at: toNullableIsoString(row?.updated_at),
    };
  }
}

/** Attendance is an audit record once the run is completed or cancelled. */
function assertTripOpen(trip: Trip): void {
  if (!isTripOpenForAttendance(trip.status)) {
    throw new ConflictException(TRIP_ATTENDANCE_TRIP_CLOSED_MESSAGE);
  }
}

/** Stop sequence first, then a stable alphabetical order inside the stop. */
function compareSeats(left: ManifestSeat, right: ManifestSeat): number {
  if (left.stop.sequence_number !== right.stop.sequence_number) {
    return left.stop.sequence_number - right.stop.sequence_number;
  }
  const byLastName = left.student.last_name.localeCompare(right.student.last_name);
  if (byLastName !== 0) {
    return byLastName;
  }
  const byFirstName = left.student.first_name.localeCompare(right.student.first_name);
  return byFirstName !== 0 ? byFirstName : left.student.id.localeCompare(right.student.id);
}

function summarise(entries: TripStudentAttendanceResponse[]): TripStudentManifestSummary {
  return {
    total: entries.length,
    pending: entries.filter((entry) => entry.status === TripAttendanceStatus.PENDING).length,
    boarded: entries.filter((entry) => entry.status === TripAttendanceStatus.BOARDED).length,
    dropped: entries.filter((entry) => entry.status === TripAttendanceStatus.DROPPED).length,
  };
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

function toNullableIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
