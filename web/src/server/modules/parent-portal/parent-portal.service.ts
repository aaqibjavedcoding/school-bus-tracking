import { NotFoundException } from '../../framework';
import { Op } from 'sequelize';
import { getTripTrackingState } from '@school-bus-tracking/validation';
import {
  AuthenticatedUser,
  ParentChildDetailResponse,
  ParentChildListResponse,
  ParentChildRunSummary,
  ParentChildSummary,
  ParentChildTodayResponse,
  ParentCrewSummary,
  ParentDashboardResponse,
  ParentTrackingResponse,
  StopResponse,
  TripResponse,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  Route,
  RouteAssignmentRole,
  Run,
  RunCrew,
  School,
  Shift,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  User,
} from '../../database/models';
import type { TenantRequestUser } from '../../common/guards';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
import { EtaService } from '../eta/eta.service';
import { TripAttendanceService } from '../trip-attendance/trip-attendance.service';
import {
  PARENT_PORTAL_BUSES_REPOSITORY,
  PARENT_PORTAL_CHILD_NOT_FOUND_MESSAGE,
  PARENT_PORTAL_GUARDIANS_REPOSITORY,
  PARENT_PORTAL_ROUTES_REPOSITORY,
  PARENT_PORTAL_SCHOOLS_REPOSITORY,
  PARENT_PORTAL_STOPS_REPOSITORY,
  PARENT_PORTAL_STUDENTS_REPOSITORY,
  PARENT_PORTAL_TRIPS_REPOSITORY,
  PARENT_PORTAL_USERS_REPOSITORY,
} from './parent-portal.constants';

/** Ranked preference when several trips exist on the same route today. */
const TRIP_PREFERENCE: Record<TripStatus, number> = {
  [TripStatus.IN_PROGRESS]: 0,
  [TripStatus.BOARDING]: 1,
  [TripStatus.SCHEDULED]: 2,
  [TripStatus.COMPLETED]: 3,
  [TripStatus.CANCELLED]: 4,
};

function startOfUtcDay(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Inclusive window covering the current UTC calendar day. */
function buildTodayRange(): Record<symbol, Date> {
  const start = startOfUtcDay(new Date().toISOString().slice(0, 10));
  return { [Op.gte]: start, [Op.lt]: addDays(start, 1) };
}

/** Picks the single "today's trip" for a route (active runs win, then earliest). */
function pickTodayTrip(trips: Trip[]): Trip {
  return [...trips].sort((a, b) => {
    const rank = TRIP_PREFERENCE[a.status] - TRIP_PREFERENCE[b.status];
    if (rank !== 0) return rank;
    return a.scheduled_start_at.getTime() - b.scheduled_start_at.getTime();
  })[0];
}

function toTripResponse(trip: Trip): TripResponse {
  const iso = (v: Date | null | undefined): string | null => (v ? v.toISOString() : null);
  return {
    id: trip.id,
    school_id: trip.school_id,
    route_id: trip.route_id,
    run_id: trip.run_id ?? null,
    bus_id: trip.bus_id ?? null,
    driver_id: trip.driver_id ?? null,
    conductor_id: trip.conductor_id ?? null,
    status: trip.status,
    scheduled_start_at: iso(trip.scheduled_start_at) ?? '',
    scheduled_end_at: iso(trip.scheduled_end_at),
    actual_start_at: iso(trip.actual_start_at),
    actual_end_at: iso(trip.actual_end_at),
    cancelled_at: iso(trip.cancelled_at),
    cancellation_reason: trip.cancellation_reason ?? null,
    created_at: iso(trip.created_at) ?? '',
    updated_at: iso(trip.updated_at) ?? '',
  };
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Read-only Parent Portal service.
 *
 * Authorization is enforced in one place: the authenticated user must be a
 * `PARENT` (guards) and every child must be linked to the JWT subject through
 * an **active** `StudentGuardian` row inside the JWT tenant. A client-supplied
 * `parent_id` or `school_id` is never read or trusted. Attendance is re-used
 * from `TripAttendanceService.getStudent` (read-only for parents) and live
 * locations from `LiveTrackingService` — the same services the crew/admin
 * surfaces use, so no duplicate tracking or attendance logic exists.
 */
export class ParentPortalService {
  constructor(
    private readonly guardians: typeof StudentGuardian,
    private readonly students: typeof Student,
    private readonly stops: typeof Stop,
    private readonly routes: typeof Route,
    private readonly buses: typeof Bus,
    private readonly trips: typeof Trip,
    private readonly users: typeof User,
    private readonly schools: typeof School,
    private readonly liveTracking: LiveTrackingService,
    private readonly tripAttendance: TripAttendanceService,
    // Task 22: approximate ETA re-used from the same service the trip ETA
    // endpoint uses — no duplicate ETA logic exists in the parent portal.
    private readonly eta: EtaService,
    // Phase 3: the child's run is the source of truth for bus + crew
    // (`docs/operating-model.md` §2, §8.4).
    private readonly runs: typeof Run,
    private readonly runCrew: typeof RunCrew,
    private readonly shifts: typeof Shift,
  ) {}

  /** The (run, route-default-run) context needed by all parent reads. */

  /** `GET /api/v1/parent/dashboard` */
  async getDashboard(user: TenantRequestUser): Promise<ParentDashboardResponse> {
    const [childrenResult, school, parentUser] = await Promise.all([
      this.listChildren(user),
      this.schools.findOne({ where: { id: user.school_id } }),
      this.users.findOne({ where: { id: user.id, school_id: user.school_id } }),
    ]);

    return {
      parent: this.toAuthenticatedUser(user, parentUser),
      school: school
        ? { id: school.id, name: school.name, code: school.code, is_active: school.is_active }
        : null,
      children: childrenResult.items,
      count: childrenResult.count,
    };
  }

  /** `GET /api/v1/parent/children` */
  async listChildren(user: TenantRequestUser): Promise<ParentChildListResponse> {
    const links = await this.guardians.findAll({
      where: { school_id: user.school_id, user_id: user.id, is_active: true },
      order: [['created_at', 'ASC']],
    });
    if (links.length === 0) {
      return { items: [], count: 0 };
    }

    const students = await this.students.findAll({
      where: {
        school_id: user.school_id,
        id: { [Op.in]: links.map((link) => link.student_id) },
      },
    });
    const byId = new Map(students.map((student) => [student.id, student]));

    const pairs = links
      .map((link) => {
        const student = byId.get(link.student_id);
        return student ? { student, link } : null;
      })
      .filter((pair): pair is { student: Student; link: StudentGuardian } => pair !== null);

    const { summaries } = await this.buildSummaries(user, pairs);
    return {
      items: summaries,
      count: pairs.length,
    };
  }

  /** `GET /api/v1/parent/children/:studentId` */
  async getChild(user: TenantRequestUser, studentId: string): Promise<ParentChildDetailResponse> {
    const { student, link } = await this.loadLinkedStudent(user, studentId);
    const { summaries, standingCrewByStudent } = await this.buildSummaries(user, [
      { student, link },
    ]);
    const [summary] = summaries;
    const standing = standingCrewByStudent.get(student.id);
    const [driver, conductor] = await this.loadCrew(
      user.school_id,
      summary.today.trip?.driver_id ?? standing?.driverId ?? null,
      summary.today.trip?.conductor_id ?? standing?.conductorId ?? null,
    );
    return { ...summary, driver, conductor };
  }

  /** `GET /api/v1/parent/children/:studentId/today` */
  async getChildToday(
    user: TenantRequestUser,
    studentId: string,
  ): Promise<ParentChildTodayResponse> {
    const { student, link } = await this.loadLinkedStudent(user, studentId);
    const { summaries, standingCrewByStudent } = await this.buildSummaries(user, [
      { student, link },
    ]);
    const [summary] = summaries;
    const standing = standingCrewByStudent.get(student.id);
    const [driver, conductor] = await this.loadCrew(
      user.school_id,
      summary.today.trip?.driver_id ?? standing?.driverId ?? null,
      summary.today.trip?.conductor_id ?? standing?.conductorId ?? null,
    );
    return {
      child: summary,
      driver,
      conductor,
      stops: await this.loadRouteStops(user.school_id, summary.home_stop.route_id),
    };
  }

  /** `GET /api/v1/parent/children/:studentId/tracking` */
  async getChildTracking(
    user: TenantRequestUser,
    studentId: string,
  ): Promise<ParentTrackingResponse> {
    const { student, link } = await this.loadLinkedStudent(user, studentId);
    const { summaries, standingCrewByStudent } = await this.buildSummaries(user, [
      { student, link },
    ]);
    const [summary] = summaries;
    const standing = standingCrewByStudent.get(student.id);
    const [driver, conductor] = await this.loadCrew(
      user.school_id,
      summary.today.trip?.driver_id ?? standing?.driverId ?? null,
      summary.today.trip?.conductor_id ?? standing?.conductorId ?? null,
    );

    let latest: ParentTrackingResponse['latest'] = null;
    let eta: ParentTrackingResponse['eta'] = null;
    const trip = summary.today.trip;
    if (trip) {
      const tripRow = await this.trips.findOne({
        where: { school_id: user.school_id, id: trip.id },
      });
      if (tripRow) {
        const location = await this.liveTracking.getLatestLocationResponse(
          user.school_id,
          tripRow.id,
        );
        if (location) {
          latest = {
            ...location,
            trip_status: tripRow.status,
            tracking_state: getTripTrackingState(tripRow.status),
          };
        }
        // Task 22: the same approximate ETA the trip ETA endpoint serves —
        // computed here over the child's own (tenant-resolved) trip.
        eta = await this.eta.computeTripEta({ trip: tripRow, latest: location });
      }
    }

    return {
      child: summary,
      trip,
      driver,
      conductor,
      stops: await this.loadRouteStops(user.school_id, summary.home_stop.route_id),
      latest,
      eta,
    };
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  /** Loads one active link + student or throws the generic child 404. */
  private async loadLinkedStudent(
    user: TenantRequestUser,
    studentId: string,
  ): Promise<{ student: Student; link: StudentGuardian }> {
    const link = await this.guardians.findOne({
      where: {
        school_id: user.school_id,
        user_id: user.id,
        student_id: studentId,
        is_active: true,
      },
    });
    if (!link) {
      throw new NotFoundException(PARENT_PORTAL_CHILD_NOT_FOUND_MESSAGE);
    }
    const student = await this.students.findOne({
      where: { school_id: user.school_id, id: studentId },
    });
    if (!student) {
      throw new NotFoundException(PARENT_PORTAL_CHILD_NOT_FOUND_MESSAGE);
    }
    return { student, link };
  }

  /**
   * Builds child summaries for the given (student, link) pairs with batched
   * lookups for stops / routes / runs / buses / trips, plus per-child
   * read-only attendance re-used from the trip-attendance service.
   *
   * Phase 3 made the child's **run** the source of truth:
   *
   * - each child's run is `students.run_id`, falling back to the route's
   *   default run — so a pre-refactor child resolves to exactly the route
   *   view they had before (zero behaviour change, §6.1);
   * - "today" only considers trips of that run: `trips.run_id` equal to the
   *   resolved run, or `NULL` (a legacy route-level dispatch), which *is* the
   *   default run's execution when the resolved run is the default;
   * - the run's bus and standing crew are shown even on days without a trip.
   */
  private async buildSummaries(
    user: TenantRequestUser,
    pairs: Array<{ student: Student; link: StudentGuardian }>,
  ): Promise<{ summaries: ParentChildSummary[]; standingCrewByStudent: Map<string, { driverId: string | null; conductorId: string | null }> }> {
    const students = pairs.map((pair) => pair.student);
    const linkByStudent = new Map(pairs.map((pair) => [pair.student.id, pair.link]));

    const stopIds = [...new Set(students.map((s) => s.home_stop_id).filter(isNonEmptyString))];
    const stops = stopIds.length
      ? await this.stops.findAll({ where: { school_id: user.school_id, id: { [Op.in]: stopIds } } })
      : [];
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));

    const routeIds = [...new Set(stops.map((stop) => stop.route_id))];
    const routes = routeIds.length
      ? await this.routes.findAll({
          where: { school_id: user.school_id, id: { [Op.in]: routeIds } },
        })
      : [];
    const routeById = new Map(routes.map((route) => [route.id, route]));

    // Runs: the explicitly allocated ones plus every route's default, in one
    // batch. `defaultByRoute` powers both the run fallback and the legacy
    // NULL-run trip matching below.
    const allocatedRunIds = [...new Set(students.map((s) => s.run_id).filter(isNonEmptyString))];
    const runs =
      allocatedRunIds.length || routeIds.length
        ? await this.runs.findAll({
            where: {
              school_id: user.school_id,
              [Op.or]: [
                ...(allocatedRunIds.length ? [{ id: { [Op.in]: allocatedRunIds } }] : []),
                ...(routeIds.length ? [{ route_id: { [Op.in]: routeIds }, is_default: true }] : []),
              ],
            },
          })
        : [];
    const runById = new Map(runs.map((run) => [run.id, run]));
    const defaultByRoute = new Map(runs.filter((run) => run.is_default).map((run) => [run.route_id, run]));

    const resolveRun = (student: Student, routeId: string | null): Run | null => {
      if (student.run_id) {
        const allocated = runById.get(student.run_id);
        if (allocated) return allocated;
        // `run_id` pointed at a retired run — fall through to the default.
      }
      return routeId ? defaultByRoute.get(routeId) ?? null : null;
    };

    const tripListsByRoute = await this.loadTodayTripsByRoute(user.school_id, routeIds);
    const busIds = [
      ...new Set(
        [
          ...[...tripListsByRoute.values()].flat().map((trip) => trip.bus_id),
          ...runs.map((run) => run.bus_id),
        ].filter(isNonEmptyString),
      ),
    ];
    const buses = busIds.length
      ? await this.buses.findAll({ where: { school_id: user.school_id, id: { [Op.in]: busIds } } })
      : [];
    const busById = new Map(buses.map((bus) => [bus.id, bus]));

    const { shiftById, crewByRun, crewUserById } = await this.loadRunDetails(user.school_id, runs);

    const tripByChild = new Map<string, Trip>();
    for (const student of students) {
      const routeId = student.home_stop_id
        ? stopById.get(student.home_stop_id)?.route_id
        : undefined;
      const candidates = routeId ? tripListsByRoute.get(routeId) ?? [] : [];
      const run = resolveRun(student, routeId ?? null);
      const matched = run
        ? candidates.filter((trip) => (trip.run_id ?? defaultByRoute.get(trip.route_id)?.id ?? null) === run.id)
        : candidates;
      if (matched.length > 0) tripByChild.set(student.id, pickTodayTrip(matched));
    }
    const trips = [...tripByChild.values()];

    const attendance = await this.loadAttendance(user, students, tripByChild);

    const standingCrewByStudent = new Map<
      string,
      { driverId: string | null; conductorId: string | null }
    >();
    const summaries = students.map((student) => {
      const stop = student.home_stop_id ? stopById.get(student.home_stop_id) : undefined;
      const routeId = stop?.route_id ?? null;
      const route = routeId ? routeById.get(routeId) ?? null : null;
      const trip = tripByChild.get(student.id) ?? null;
      const run = resolveRun(student, routeId);
      const tripBus = trip?.bus_id ? busById.get(trip.bus_id) : undefined;
      const crew = run ? crewByRun.get(run.id) : undefined;
      if (run) {
        standingCrewByStudent.set(student.id, {
          driverId: crew?.driver?.user_id ?? null,
          conductorId: crew?.conductor?.user_id ?? null,
        });
      }
      return this.toChildSummary(
        student,
        linkByStudent.get(student.id) ?? null,
        stop ?? null,
        route,
        trip,
        tripBus ?? (run?.bus_id ? busById.get(run.bus_id) ?? null : null),
        trip && attendance.get(`${trip.id}:${student.id}`)
          ? attendance.get(`${trip.id}:${student.id}`)!
          : null,
        run ? this.toRunSummary(run, route, shiftById, crewByRun, crewUserById, busById) : null,
      );
    });
    return { summaries, standingCrewByStudent };
  }

  /**
   * Batched shift + roster enrichment for a set of runs (one query per
   * dimension — a parent dashboard never pays per-child).
   */
  private async loadRunDetails(
    schoolId: string,
    runs: Run[],
  ): Promise<{
    shiftById: Map<string, Shift>;
    crewByRun: Map<
      string,
      { driver?: RunCrew; conductor?: RunCrew }
    >;
    crewUserById: Map<string, User>;
  }> {
    const shiftById = new Map<string, Shift>();
    const crewByRun = new Map<string, { driver?: RunCrew; conductor?: RunCrew }>();
    const crewUserById = new Map<string, User>();
    if (runs.length === 0) return { shiftById, crewByRun, crewUserById };

    const shiftIds = [...new Set(runs.map((run) => run.shift_id).filter(isNonEmptyString))];
    const shifts = shiftIds.length
      ? await this.shifts.findAll({
          where: { school_id: schoolId, id: { [Op.in]: shiftIds } },
        })
      : [];
    for (const shift of shifts) shiftById.set(shift.id, shift);

    const today = new Date().toISOString().slice(0, 10);
    const crewRows = await this.runCrew.findAll({
      where: {
        school_id: schoolId,
        run_id: { [Op.in]: runs.map((run) => run.id) },
        is_active: true,
        effective_from: { [Op.lte]: today },
        [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: today } }],
      },
      order: [['effective_from', 'ASC']],
    });
    for (const row of crewRows) {
      // `effective_from ASC` — the latest roster row per (run, role) wins,
      // mirroring the dispatch resolution in `TripsService`.
      const seat = row.role === RouteAssignmentRole.DRIVER ? 'driver' : 'conductor';
      const entry = crewByRun.get(row.run_id) ?? {};
      entry[seat] = row;
      crewByRun.set(row.run_id, entry);
    }

    const crewUserIds = [
      ...new Set(
        [...crewByRun.values()].flatMap((seat) => [seat.driver?.user_id, seat.conductor?.user_id]),
      ),
    ].filter(isNonEmptyString);
    if (crewUserIds.length) {
      const users = await this.users.findAll({
        where: { school_id: schoolId, id: { [Op.in]: crewUserIds } },
        attributes: ['id', 'first_name', 'last_name'],
      });
      for (const user of users) crewUserById.set(user.id, user);
    }
    return { shiftById, crewByRun, crewUserById };
  }

  /** The run block of a child summary (source of truth for bus + crew). */
  private toRunSummary(
    run: Run,
    route: Route | null,
    shiftById: Map<string, Shift>,
    crewByRun: Map<string, { driver?: RunCrew; conductor?: RunCrew }>,
    crewUserById: Map<string, User>,
    busById: Map<string, Bus>,
  ): ParentChildRunSummary {
    const shift = run.shift_id ? shiftById.get(run.shift_id) : undefined;
    const seat = crewByRun.get(run.id) ?? {};
    const nameOf = (userId?: string): string | null => {
      const user = userId ? crewUserById.get(userId) : undefined;
      return user ? `${user.first_name} ${user.last_name}`.trim() : null;
    };
    const bus = run.bus_id ? busById.get(run.bus_id) : undefined;
    return {
      id: run.id,
      code: run.code,
      is_default: run.is_default,
      route_id: run.route_id,
      route_code: route?.code ?? null,
      route_name: route?.name ?? null,
      shift_name: shift?.name ?? null,
      shift_start_time: shift?.start_time ?? null,
      shift_end_time: shift?.end_time ?? null,
      bus_id: run.bus_id ?? null,
      bus_number: bus?.bus_number ?? null,
      registration_number: bus?.registration_number ?? null,
      driver_name: nameOf(seat.driver?.user_id),
      conductor_name: nameOf(seat.conductor?.user_id),
    };
  }

  /** Batches today's trips for a set of route ids into route → trip lists. */
  private async loadTodayTripsByRoute(
    schoolId: string,
    routeIds: string[],
  ): Promise<Map<string, Trip[]>> {
    const result = new Map<string, Trip[]>();
    if (routeIds.length === 0) return result;

    const trips = await this.trips.findAll({
      where: {
        school_id: schoolId,
        route_id: { [Op.in]: routeIds },
        scheduled_start_at: buildTodayRange(),
      },
      order: [['scheduled_start_at', 'ASC']],
    });

    for (const trip of trips) {
      const list = result.get(trip.route_id) ?? [];
      list.push(trip);
      result.set(trip.route_id, list);
    }
    return result;
  }

  /** Per-child read-only attendance (re-used from TripAttendanceService). */
  private async loadAttendance(
    user: TenantRequestUser,
    students: Student[],
    tripByChild: Map<string, Trip>,
  ): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    for (const student of students) {
      const trip = tripByChild.get(student.id);
      if (!trip) continue;
      try {
        const attendance = await this.tripAttendance.getStudent(user, trip.id, student.id);
        result.set(`${trip.id}:${student.id}`, attendance);
      } catch {
        // Student is not on this run (no stop / inactive / unlinked) — leave
        // their attendance null so the UI shows a neutral "not recorded".
      }
    }
    return result;
  }

  /** Ordered stops of a route (or empty when the child has no route yet). */
  private async loadRouteStops(schoolId: string, routeId: string | null): Promise<StopResponse[]> {
    if (!routeId) return [];
    const rows = await this.stops.findAll({
      where: { school_id: schoolId, route_id: routeId },
      order: [['sequence_number', 'ASC']],
    });
    return rows.map((stop) => this.toStopResponse(stop));
  }
  private toStopResponse(stop: Stop): StopResponse {
    return {
      id: stop.id,
      school_id: stop.school_id,
      route_id: stop.route_id,
      name: stop.name,
      address: stop.address,
      latitude: stop.latitude,
      longitude: stop.longitude,
      geofence_radius_meters: stop.geofence_radius_meters,
      sequence_number: stop.sequence_number,
      estimated_arrival_time: stop.estimated_arrival_time,
      is_active: stop.is_active,
      created_at: stop.created_at.toISOString(),
      updated_at: stop.updated_at.toISOString(),
    };
  }

  /** Driver / conductor display names (never account internals). */
  private async loadCrew(
    schoolId: string,
    driverId: string | null,
    conductorId: string | null,
  ): Promise<[ParentCrewSummary | null, ParentCrewSummary | null]> {
    const ids = [driverId, conductorId].filter(isNonEmptyString);
    if (ids.length === 0) return [null, null];
    const rows = await this.users.findAll({
      where: { school_id: schoolId, id: { [Op.in]: ids } },
      attributes: ['id', 'first_name', 'last_name'],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const crew = (id: string | null): ParentCrewSummary | null => {
      if (!id) return null;
      const row = byId.get(id);
      return row ? { id: row.id, first_name: row.first_name, last_name: row.last_name } : null;
    };
    return [crew(driverId), crew(conductorId)];
  }
  private toChildSummary(
    student: Student,
    link: StudentGuardian | null,
    stop: Stop | null,
    route: Route | null,
    trip: Trip | null,
    bus: Bus | null,
    attendance: unknown,
    run: ParentChildRunSummary | null = null,
  ): ParentChildSummary {
    return {
      id: student.id,
      school_id: student.school_id,
      admission_number: student.admission_number,
      first_name: student.first_name,
      last_name: student.last_name,
      grade_level: student.grade_level,
      is_active: student.is_active,
      relationship: link?.relationship ?? '',
      can_pick_up: link?.can_pick_up ?? false,
      is_primary: link?.is_primary ?? false,
      home_stop: {
        id: stop?.id ?? null,
        name: stop?.name ?? null,
        address: stop?.address ?? null,
        latitude: stop?.latitude ?? null,
        longitude: stop?.longitude ?? null,
        sequence_number: stop?.sequence_number ?? null,
        route_id: route?.id ?? null,
        route_code: route?.code ?? null,
        route_name: route?.name ?? null,
      },
      run,
      today: {
        trip: trip ? toTripResponse(trip) : null,
        attendance: (attendance as ParentChildSummary['today']['attendance']) ?? null,
        bus: bus
          ? {
              id: bus.id,
              registration_number: bus.registration_number,
              bus_number: bus.bus_number,
            }
          : null,
      },
    };
  }
  private toAuthenticatedUser(user: TenantRequestUser, parentUser: User | null): AuthenticatedUser {
    return {
      id: user.id,
      school_id: user.school_id,
      role: UserRole.PARENT,
      first_name: parentUser?.first_name ?? '',
      last_name: parentUser?.last_name ?? '',
      email: parentUser?.email ?? null,
    };
  }
}
