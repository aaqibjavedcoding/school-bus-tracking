import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  RouteAssignmentRole,
  TripDeleteResponse,
  TripListResponse,
  TripMinimalListResponse,
  TripMinimalResponse,
  TripResponse,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { isTripStatusTransitionAllowed } from '@school-bus-tracking/validation';
import { Bus, Route, RouteAssignment, Run, RunCrew, Trip, User } from '../../database/models';
import type { TenantRequestUser as AuthenticatedRequestUser } from '../../common/guards';
import { PlanLimitsService } from '../../common/plan-limits';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  TRIP_ACTUAL_RANGE_MESSAGE,
  TRIP_ASSIGNMENT_BUS_MISSING_MESSAGE,
  TRIP_ASSIGNMENT_INACTIVE_MESSAGE,
  TRIP_ASSIGNMENT_INVALID_MESSAGE,
  TRIP_ASSIGNMENT_PERIOD_MESSAGE,
  TRIP_BUS_INVALID_MESSAGE,
  TRIP_CONDUCTOR_INVALID_MESSAGE,
  TRIP_CONFLICT_MESSAGE,
  TRIP_DATE_INVALID_MESSAGE,
  TRIP_DATE_RANGE_MESSAGE,
  TRIP_DELETED_MESSAGE,
  TRIP_DISPATCH_SOURCE_MESSAGE,
  TRIP_DRIVER_INVALID_MESSAGE,
  TRIP_DRIVER_MISSING_MESSAGE,
  TRIP_RUN_DRIVER_MISSING_MESSAGE,
  TRIP_RUN_INACTIVE_MESSAGE,
  TRIP_RUN_INVALID_MESSAGE,
  TRIP_INACTIVE_RESOURCE_MESSAGE,
  TRIP_INVALID_TRANSITION_MESSAGE,
  TRIP_NOT_EDITABLE_MESSAGE,
  TRIP_NOT_FOUND_MESSAGE,
  TRIP_QUERY_DATE_RANGE_MESSAGE,
  TRIP_ROUTE_INVALID_MESSAGE,
  TRIPS_BUSES_REPOSITORY,
  TRIPS_REPOSITORY,
  TRIPS_ROUTE_ASSIGNMENTS_REPOSITORY,
  TRIPS_ROUTES_REPOSITORY,
  TRIPS_USERS_REPOSITORY,
} from './trips.constants';
import { CancelTripDto } from './dto/cancel-trip.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { ListTripsQueryDto } from './dto/list-trips-query.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';

/** Parent-visibility restriction applied on top of the tenant where clause. */
export interface TripListScope {
  routeIds?: string[];
  /** Routes whose parents see run-level trips only (a child is run-allocated). */
  runScopedRouteIds?: string[];
  /** Run ids visible to the calling parent. */
  runIds?: string[];
  /** Run-scoped routes whose children ride the default run (legacy trips OK). */
  defaultRiderRouteIds?: string[];
}

/** Resources a trip is dispatched with, derived from a roster row or a run. */
interface DispatchTarget {
  /** The dispatched run; `null` for a legacy route-assignment dispatch. */
  run_id: string | null;
  route_id: string;
  bus_id: string | null;
  driver_id: string;
  conductor_id: string | null;
}

/**
 * Tenant-safe trip management.
 *
 * A trip is never assembled from client-supplied ids. The caller nominates an
 * **active** `RouteAssignment` and the service derives the school, route, bus,
 * driver and conductor from it, re-checking every derived record against the
 * JWT tenant and its active flag. That makes a cross-tenant or mismatched
 * crew/vehicle combination impossible to persist, and keeps the trip an
 * auditable snapshot of who actually ran the route.
 *
 * The lifecycle (`SCHEDULED → BOARDING → IN_PROGRESS → COMPLETED`, with
 * `CANCELLED` reachable from any non-terminal state) is enforced here through
 * the shared transition table; the database only constrains the value set.
 *
 * Every successful transition (and the soft delete that cancels still-open
 * runs) is forwarded to `LiveTrackingService.onTripStatusChanged`, which is
 * what stops a terminal trip from accepting GPS fixes and notifies the
 * connected sockets. Successful transitions additionally notify the linked
 * parents through `NotificationsService` (boarding, departure, completion,
 * cancellation) — always after the update has been persisted, so an invalid
 * or failed transition can never produce a notification. The transition rules
 * themselves are untouched.
 */
export class TripsService {
  constructor(
    private readonly trips: typeof Trip,
    private readonly assignments: typeof RouteAssignment,
    private readonly routes: typeof Route,
    private readonly buses: typeof Bus,
    private readonly users: typeof User,
    private readonly liveTracking: LiveTrackingService,
    private readonly notifications: NotificationsService,
    private readonly planLimits: PlanLimitsService,
    private readonly runs: typeof Run,
    private readonly runCrew: typeof RunCrew,
  ) {}

  /** Dispatches a new `SCHEDULED` trip from an active roster row. */
  async create(schoolId: string, dto: CreateTripDto): Promise<TripResponse> {
    const scheduledStartAt = parseDateTime(dto.scheduled_start_at);
    const scheduledEndAt = parseNullableDateTime(dto.scheduled_end_at);
    assertScheduleRange(scheduledStartAt, scheduledEndAt);

    const target = await this.resolveDispatch(schoolId, dto, scheduledStartAt);
    await this.assertNoScheduleConflict(schoolId, target, scheduledStartAt, undefined);

    try {
      const trip = await this.trips.create({
        school_id: schoolId,
        route_id: target.route_id,
        run_id: target.run_id,
        bus_id: target.bus_id,
        driver_id: target.driver_id,
        conductor_id: target.conductor_id,
        status: TripStatus.SCHEDULED,
        scheduled_start_at: scheduledStartAt,
        scheduled_end_at: scheduledEndAt,
        actual_start_at: null,
        actual_end_at: null,
        cancelled_at: null,
        cancellation_reason: null,
      });
      return this.toResponse(trip);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(TRIP_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Lists trips the caller is allowed to see.
   *
   * Admins see the whole school. Drivers and conductors are pinned to the
   * dispatch snapshot (`driver_id` / `conductor_id`) so they cannot probe
   * another crew's runs. Parents see only trips whose route carries a linked
   * child's home stop.
   */
  async findAllForActor(
    actor: AuthenticatedRequestUser,
    query: ListTripsQueryDto,
  ): Promise<TripListResponse> {
    if (actor.role === UserRole.SCHOOL_ADMIN) {
      return this.findAll(actor.school_id, query);
    }

    if (actor.role === UserRole.DRIVER) {
      const scoped = cloneTripListQuery(query);
      scoped.driver_id = actor.id;
      return this.findAll(actor.school_id, scoped);
    }

    if (actor.role === UserRole.CONDUCTOR) {
      const scoped = cloneTripListQuery(query);
      scoped.conductor_id = actor.id;
      return this.findAll(actor.school_id, scoped);
    }

    if (actor.role === UserRole.PARENT) {
      const scope = await this.liveTracking.getParentTripScope(actor);
      if (scope.routeIds.length === 0) {
        return emptyTripList(query);
      }
      if (query.route_id !== undefined && !scope.routeIds.includes(query.route_id)) {
        return emptyTripList(query);
      }
      return this.findAll(actor.school_id, query, {
        routeIds: query.route_id ? [query.route_id] : scope.routeIds,
        runScopedRouteIds: query.route_id
          ? scope.runScopedRouteIds.filter((routeId) => routeId === query.route_id)
          : scope.runScopedRouteIds,
        runIds: scope.runIds,
        defaultRiderRouteIds: query.route_id
          ? scope.defaultRiderRouteIds.filter((routeId) => routeId === query.route_id)
          : scope.defaultRiderRouteIds,
      });
    }

    return emptyTripList(query);
  }

  /**
   * Lists trips of the authenticated school only.
   *
   * The overloads keep the return type honest: a `minimal` query is answered
   * with raw trip rows, everything else with the enriched projection.
   */
  async findAll(
    schoolId: string,
    query: ListTripsQueryDto & { include: 'minimal' },
    scope?: TripListScope,
  ): Promise<TripMinimalListResponse>;
  async findAll(
    schoolId: string,
    query: ListTripsQueryDto,
    scope?: TripListScope,
  ): Promise<TripListResponse>;
  async findAll(
    schoolId: string,
    query: ListTripsQueryDto,
    scope?: TripListScope,
  ): Promise<TripListResponse | TripMinimalListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = { school_id: schoolId };

    if (query.status !== undefined) where.status = query.status;
    if (scope?.routeIds !== undefined) {
      where.route_id = { [Op.in]: scope.routeIds };
    } else if (query.route_id !== undefined) {
      where.route_id = query.route_id;
    }
    if (scope?.runScopedRouteIds !== undefined && scope.runScopedRouteIds.length > 0) {
      // A parent with a run-allocated child sees that run's trips only;
      // routes where no child is run-allocated keep the legacy route-level
      // view. A trip with a `NULL` run belongs to its route's default run
      // (`docs/operating-model.md` §6.1), so `run_id IS NULL` trips stay
      // visible exactly as before whenever the default run is what the child
      // rides.
      where[Op.and] = [
        {
          [Op.or]: [
            { route_id: { [Op.notIn]: scope.runScopedRouteIds } },
            { run_id: { [Op.in]: scope.runIds ?? [] } },
            ...(scope.defaultRiderRouteIds && scope.defaultRiderRouteIds.length > 0
              ? [{ route_id: { [Op.in]: scope.defaultRiderRouteIds }, run_id: null }]
              : []),
          ],
        },
      ];
    }
    if (query.run_id !== undefined) where.run_id = query.run_id;
    if (query.bus_id !== undefined) where.bus_id = query.bus_id;
    if (query.driver_id !== undefined) where.driver_id = query.driver_id;
    if (query.conductor_id !== undefined) where.conductor_id = query.conductor_id;

    const scheduledRange = buildScheduledRange(query);
    if (scheduledRange) where.scheduled_start_at = scheduledRange;

    const search = query.search?.trim();
    if (search) {
      where[Op.or] = await this.buildSearchWhere(schoolId, search);
    }

    const { rows, count } = await this.trips.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['scheduled_start_at', 'DESC'],
        ['route_id', 'ASC'],
      ],
    });

    const totalPages = Math.ceil(count / limit);
    const meta: PaginationMeta = {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    // `include=minimal` skips the route/bus/crew name resolution entirely —
    // the raw trip rows are enough for pickers and id-based callers.
    if (query.include === 'minimal') {
      return { items: rows.map((trip) => toTripMinimalResponse(trip)), meta };
    }

    return { items: await this.toResponses(rows), meta };
  }

  /**
   * Number of today's (UTC) trips currently `BOARDING` or `IN_PROGRESS`.
   *
   * One indexed `COUNT(*)`, no joins — the live-trips stat card used to pay
   * for a whole enriched list response to learn this single number.
   */
  async countActiveToday(schoolId: string): Promise<number> {
    return this.trips.count({
      where: {
        school_id: schoolId,
        status: { [Op.in]: [TripStatus.BOARDING, TripStatus.IN_PROGRESS] },
        scheduled_start_at: todayRange(),
      } as WhereOptions,
    });
  }

  /** Returns a trip only when its id and school both match. */
  async findOne(schoolId: string, id: string): Promise<TripResponse> {
    const trip = await this.findTripOrThrow(schoolId, id);
    return this.toResponse(trip);
  }

  /**
   * Returns a trip the caller is allowed to observe. Unknown ids, other
   * tenants and "not my trip" collapse into the same generic 404.
   */
  async findOneForActor(actor: AuthenticatedRequestUser, id: string): Promise<TripResponse> {
    const auth = await this.liveTracking.authorizeObservation(actor, id);
    if (!auth.ok) {
      throw new NotFoundException(TRIP_NOT_FOUND_MESSAGE);
    }
    return this.toResponse(auth.trip);
  }

  /**
   * Reschedules or re-dispatches a trip that has not started yet.
   *
   * Supplying `route_assignment_id` re-derives route, bus and crew from the
   * roster (validated against the new schedule); omitting it keeps the current
   * dispatch snapshot and only moves the planned times.
   */
  async update(schoolId: string, id: string, dto: UpdateTripDto): Promise<TripResponse> {
    const trip = await this.findTripOrThrow(schoolId, id);
    if (trip.status !== TripStatus.SCHEDULED) {
      throw new ConflictException(TRIP_NOT_EDITABLE_MESSAGE);
    }

    const scheduledStartAt =
      dto.scheduled_start_at === undefined
        ? toDate(trip.scheduled_start_at)
        : parseDateTime(dto.scheduled_start_at);
    const scheduledEndAt =
      dto.scheduled_end_at === undefined
        ? parseNullableDateTime(trip.scheduled_end_at)
        : parseNullableDateTime(dto.scheduled_end_at);
    assertScheduleRange(scheduledStartAt, scheduledEndAt);

    const values: Record<string, unknown> = {
      scheduled_start_at: scheduledStartAt,
      scheduled_end_at: scheduledEndAt,
    };

    let target: DispatchTarget | null = null;
    if (dto.run_id !== undefined || dto.route_assignment_id !== undefined) {
      target = await this.resolveDispatch(schoolId, dto, scheduledStartAt);
      // Re-dispatch replaces the whole snapshot — including clearing the run
      // when the legacy assignment path is chosen — so the trip never mixes
      // resources from two sources.
      values.route_id = target.route_id;
      values.run_id = target.run_id;
      values.bus_id = target.bus_id;
      values.driver_id = target.driver_id;
      values.conductor_id = target.conductor_id;
    }

    await this.assertNoScheduleConflict(
      schoolId,
      target ?? { run_id: trip.run_id, route_id: trip.route_id },
      scheduledStartAt,
      id,
    );

    try {
      await trip.update(values);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(TRIP_CONFLICT_MESSAGE);
      }
      throw error;
    }

    return this.toResponse(trip);
  }

  /**
   * Applies exactly one lifecycle transition when the caller is the school
   * admin or rostered crew of the trip. Non-crew callers see the generic 404.
   */
  async updateStatusForActor(
    actor: AuthenticatedRequestUser,
    id: string,
    dto: UpdateTripStatusDto,
  ): Promise<TripResponse> {
    const trip = await this.findTripOrThrow(actor.school_id, id);
    if (actor.role !== UserRole.SCHOOL_ADMIN) {
      const isCrew = await this.liveTracking.isCrewOfTrip(actor, trip);
      if (!isCrew) {
        throw new NotFoundException(TRIP_NOT_FOUND_MESSAGE);
      }
    }
    return this.updateStatus(actor.school_id, id, dto);
  }

  /** Applies exactly one lifecycle transition. */
  async updateStatus(
    schoolId: string,
    id: string,
    dto: UpdateTripStatusDto,
  ): Promise<TripResponse> {
    const trip = await this.findTripOrThrow(schoolId, id);
    const current = trip.status;
    const next = dto.status;

    if (!isTripStatusTransitionAllowed(current, next)) {
      throw new BadRequestException(TRIP_INVALID_TRANSITION_MESSAGE(current, next));
    }

    const now = new Date();
    const values: Record<string, unknown> = { status: next };

    if (next === TripStatus.IN_PROGRESS) {
      values.actual_start_at =
        parseNullableDateTime(dto.actual_start_at) ?? toNullableDate(trip.actual_start_at) ?? now;
    }

    if (next === TripStatus.COMPLETED) {
      const actualStartAt =
        parseNullableDateTime(dto.actual_start_at) ?? toNullableDate(trip.actual_start_at) ?? now;
      const actualEndAt = parseNullableDateTime(dto.actual_end_at) ?? now;
      if (actualEndAt.getTime() < actualStartAt.getTime()) {
        throw new BadRequestException(TRIP_ACTUAL_RANGE_MESSAGE);
      }
      values.actual_start_at = actualStartAt;
      values.actual_end_at = actualEndAt;
    }

    if (next === TripStatus.CANCELLED) {
      values.cancelled_at = now;
      values.cancellation_reason = normalizeReason(dto.cancellation_reason);
    }

    await trip.update(values);
    await this.liveTracking.onTripStatusChanged(trip);
    // Only a persisted transition notifies the parents; the notifications
    // service is best-effort and never fails the trip lifecycle itself.
    await this.notifications.notifyTripStatusChange({
      school_id: trip.school_id,
      trip_id: trip.id,
      status: trip.status,
      cancellation_reason: trip.cancellation_reason ?? null,
    });
    return this.toResponse(trip);
  }

  /**
   * Cancels a non-terminal trip. The row is kept (and stays visible in
   * reporting) with its cancellation timestamp and reason.
   */
  async cancel(schoolId: string, id: string, dto: CancelTripDto): Promise<TripResponse> {
    const statusDto = new UpdateTripStatusDto();
    statusDto.status = TripStatus.CANCELLED;
    statusDto.cancellation_reason = dto.cancellation_reason;
    return this.updateStatus(schoolId, id, statusDto);
  }

  /**
   * Deactivates a trip: still-open runs are cancelled first so the lifecycle
   * stays consistent, then the row is paranoid soft-deleted.
   */
  async remove(schoolId: string, id: string): Promise<TripDeleteResponse> {
    const trip = await this.findTripOrThrow(schoolId, id);

    if (isTripStatusTransitionAllowed(trip.status, TripStatus.CANCELLED)) {
      await trip.update({
        status: TripStatus.CANCELLED,
        cancelled_at: new Date(),
        cancellation_reason: trip.cancellation_reason ?? null,
      });
    }

    await trip.destroy();
    // The run is gone: observers get a terminal `trip:tracking:stopped`
    // event and no fix for this trip is ever accepted again.
    await this.liveTracking.onTripStatusChanged(trip, { deleted: true });
    return { id, message: TRIP_DELETED_MESSAGE };
  }
  private async findTripOrThrow(schoolId: string, id: string): Promise<Trip> {
    const trip = await this.trips.findOne({ where: { id, school_id: schoolId } });
    if (!trip) {
      throw new NotFoundException(TRIP_NOT_FOUND_MESSAGE);
    }
    return trip;
  }

  /**
   * Picks the dispatch source: `run_id` (preferred, `docs/operating-model.md`
   * §8.4) or the deprecated `route_assignment_id`. Exactly one must be named;
   * both or neither is a 400, because a trip that mixes a run with a route
   * roster row has no single, auditable snapshot.
   */
  private async resolveDispatch(
    schoolId: string,
    source: { run_id?: string; route_assignment_id?: string },
    scheduledStartAt: Date,
  ): Promise<DispatchTarget> {
    if (source.run_id !== undefined && source.route_assignment_id !== undefined) {
      throw new BadRequestException(TRIP_DISPATCH_SOURCE_MESSAGE);
    }
    if (source.run_id !== undefined) {
      return this.resolveRunDispatchTarget(schoolId, source.run_id, scheduledStartAt);
    }
    if (source.route_assignment_id !== undefined) {
      return this.resolveAssignmentDispatchTarget(
        schoolId,
        source.route_assignment_id,
        scheduledStartAt,
      );
    }
    throw new BadRequestException(TRIP_DISPATCH_SOURCE_MESSAGE);
  }

  /**
   * Derives and validates the dispatch snapshot from a roster row.
   *
   * @deprecated Route-assignment dispatch is the pre-refactor path, kept so
   * existing callers keep working; its trips carry `run_id: null`, which the
   * parent-facing fallback rules read as "this route's default run".
   *
   * Every lookup is pinned to the JWT tenant, so a roster row, route, bus or
   * crew member from another school produces the same generic 400 as a
   * non-existent one and never leaks its existence.
   */
  private async resolveAssignmentDispatchTarget(
    schoolId: string,
    assignmentId: string,
    scheduledStartAt: Date,
  ): Promise<DispatchTarget> {
    const assignment = await this.assignments.findOne({
      where: { id: assignmentId, school_id: schoolId },
    });
    if (!assignment) {
      throw new BadRequestException(TRIP_ASSIGNMENT_INVALID_MESSAGE);
    }
    if (!assignment.is_active) {
      throw new BadRequestException(TRIP_ASSIGNMENT_INACTIVE_MESSAGE);
    }
    if (!assignment.bus_id) {
      throw new BadRequestException(TRIP_ASSIGNMENT_BUS_MISSING_MESSAGE);
    }

    const tripDate = toDateOnly(scheduledStartAt);
    if (!coversDate(assignment, tripDate)) {
      throw new BadRequestException(TRIP_ASSIGNMENT_PERIOD_MESSAGE);
    }

    const route = await this.routes.findOne({
      where: { id: assignment.route_id, school_id: schoolId },
    });
    if (!route) {
      throw new BadRequestException(TRIP_ROUTE_INVALID_MESSAGE);
    }

    const bus = await this.buses.findOne({
      where: { id: assignment.bus_id, school_id: schoolId },
    });
    if (!bus) {
      throw new BadRequestException(TRIP_BUS_INVALID_MESSAGE);
    }
    if (route.is_active === false || bus.is_active === false) {
      throw new BadRequestException(TRIP_INACTIVE_RESOURCE_MESSAGE);
    }

    const { driverId, conductorId } = await this.resolveCrew(schoolId, assignment, tripDate);

    await this.assertCrewMember(schoolId, driverId, UserRole.DRIVER, TRIP_DRIVER_INVALID_MESSAGE);
    if (conductorId !== null) {
      await this.assertCrewMember(
        schoolId,
        conductorId,
        UserRole.CONDUCTOR,
        TRIP_CONDUCTOR_INVALID_MESSAGE,
      );
    }

    return {
      run_id: null,
      route_id: assignment.route_id,
      bus_id: assignment.bus_id,
      driver_id: driverId,
      conductor_id: conductorId,
    };
  }

  /**
   * Derives and validates the dispatch snapshot from a **run** — the
   * target-model way to schedule a trip.
   *
   * Route and vehicle come from the run itself; the driver and conductor come
   * from its `run_crew` roster (the most recent effective row per role on the
   * trip date). A run may legitimately have no bus yet, unlike a roster row
   * dispatch — the vehicle is then `null` on the trip until fleet allocation.
   * The driver seat is mandatory: a trip without a driver cannot be sent.
   */
  private async resolveRunDispatchTarget(
    schoolId: string,
    runId: string,
    scheduledStartAt: Date,
  ): Promise<DispatchTarget> {
    const run = await this.runs.findOne({ where: { id: runId, school_id: schoolId } });
    if (!run) {
      throw new BadRequestException(TRIP_RUN_INVALID_MESSAGE);
    }
    if (!run.is_active) {
      throw new BadRequestException(TRIP_RUN_INACTIVE_MESSAGE);
    }

    const route = await this.routes.findOne({
      where: { id: run.route_id, school_id: schoolId },
    });
    if (!route) {
      throw new BadRequestException(TRIP_ROUTE_INVALID_MESSAGE);
    }

    let bus: Bus | null = null;
    if (run.bus_id) {
      bus = await this.buses.findOne({ where: { id: run.bus_id, school_id: schoolId } });
      if (!bus) {
        throw new BadRequestException(TRIP_BUS_INVALID_MESSAGE);
      }
    }
    if (route.is_active === false || bus?.is_active === false) {
      throw new BadRequestException(TRIP_INACTIVE_RESOURCE_MESSAGE);
    }

    const tripDate = toDateOnly(scheduledStartAt);
    const crewRows = await this.runCrew.findAll({
      where: {
        school_id: schoolId,
        run_id: run.id,
        is_active: true,
        effective_from: { [Op.lte]: tripDate },
        [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: tripDate } }],
      },
      order: [['effective_from', 'DESC']],
    });
    const driverRow = crewRows.find((row) => row.role === RouteAssignmentRole.DRIVER);
    if (!driverRow) {
      throw new BadRequestException(TRIP_RUN_DRIVER_MISSING_MESSAGE);
    }
    const conductorRow = crewRows.find((row) => row.role === RouteAssignmentRole.CONDUCTOR) ?? null;

    await this.assertCrewMember(
      schoolId,
      driverRow.user_id,
      UserRole.DRIVER,
      TRIP_DRIVER_INVALID_MESSAGE,
    );
    if (conductorRow) {
      await this.assertCrewMember(
        schoolId,
        conductorRow.user_id,
        UserRole.CONDUCTOR,
        TRIP_CONDUCTOR_INVALID_MESSAGE,
      );
    }

    return {
      run_id: run.id,
      route_id: run.route_id,
      bus_id: bus?.id ?? null,
      driver_id: driverRow.user_id,
      conductor_id: conductorRow?.user_id ?? null,
    };
  }

  /**
   * Resolves both crew seats.
   *
   * `RouteAssignment` stores one row per person and role, so the nominated row
   * fills its own seat and the counterpart row (same route and bus, active on
   * the trip date) fills the other. A driver is mandatory; a conductor is
   * optional because not every route runs with one.
   */
  private async resolveCrew(
    schoolId: string,
    assignment: RouteAssignment,
    tripDate: string,
  ): Promise<{ driverId: string; conductorId: string | null }> {
    if (assignment.role === RouteAssignmentRole.DRIVER) {
      const conductor = await this.findCounterpart(
        schoolId,
        assignment,
        RouteAssignmentRole.CONDUCTOR,
        tripDate,
      );
      return { driverId: assignment.user_id, conductorId: conductor?.user_id ?? null };
    }

    const driver = await this.findCounterpart(
      schoolId,
      assignment,
      RouteAssignmentRole.DRIVER,
      tripDate,
    );
    if (!driver) {
      throw new BadRequestException(TRIP_DRIVER_MISSING_MESSAGE);
    }
    return { driverId: driver.user_id, conductorId: assignment.user_id };
  }
  private async findCounterpart(
    schoolId: string,
    assignment: RouteAssignment,
    role: RouteAssignmentRole,
    tripDate: string,
  ): Promise<RouteAssignment | null> {
    const candidates = await this.assignments.findAll({
      where: {
        school_id: schoolId,
        route_id: assignment.route_id,
        role,
        is_active: true,
      },
    });

    return (
      candidates.find(
        (candidate) =>
          candidate.id !== assignment.id &&
          candidate.is_active === true &&
          (candidate.bus_id === null || candidate.bus_id === assignment.bus_id) &&
          coversDate(candidate, tripDate),
      ) ?? null
    );
  }
  private async assertCrewMember(
    schoolId: string,
    userId: string,
    role: UserRole,
    invalidMessage: string,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId, school_id: schoolId } });
    if (!user || String(user.role) !== String(role)) {
      throw new BadRequestException(invalidMessage);
    }
    if (user.is_active === false) {
      throw new BadRequestException(TRIP_INACTIVE_RESOURCE_MESSAGE);
    }
  }

  /**
   * Mirrors the `uq_trips_route_scheduled_start` and
   * `uq_trips_run_scheduled_start` partial unique indexes — both stay in
   * force (two runs of one route must not depart at the same instant: the
   * stops are shared, see `docs/operating-model.md` §3.5), and the service
   * check turns either clash into the same clean 409 instead of a raw
   * unique-violation.
   */
  private async assertNoScheduleConflict(
    schoolId: string,
    target: Pick<DispatchTarget, 'route_id' | 'run_id'>,
    scheduledStartAt: Date,
    excludeId: string | undefined,
  ): Promise<void> {
    const clash = await this.trips.findOne({
      where: {
        school_id: schoolId,
        scheduled_start_at: scheduledStartAt,
        [Op.or]: [
          { route_id: target.route_id },
          ...(target.run_id !== null ? [{ run_id: target.run_id }] : []),
        ],
      } as WhereOptions,
    });

    if (clash && clash.id !== excludeId) {
      throw new ConflictException(TRIP_CONFLICT_MESSAGE);
    }
  }

  /**
   * Explicit projection — ORM internals and associations never leak. Related
   * route / bus / crew records are resolved with batched lookups so callers
   * always get human-readable names instead of internal ids.
   */
  private async toResponse(trip: Trip): Promise<TripResponse> {
    const [response] = await this.toResponses([trip]);
    return response;
  }

  /** Batched projection with route / bus / crew names resolved in one pass. */
  private async toResponses(trips: Trip[]): Promise<TripResponse[]> {
    if (trips.length === 0) {
      return [];
    }
    const schoolId = trips[0].school_id;
    const routeIds = [...new Set(trips.map((trip) => trip.route_id))];
    const runIds = [...new Set(trips.map((trip) => trip.run_id).filter(isNonEmptyString))];
    const busIds = [...new Set(trips.map((trip) => trip.bus_id).filter(isNonEmptyString))];
    const userIds = [
      ...new Set(
        [...trips.map((trip) => trip.driver_id), ...trips.map((trip) => trip.conductor_id)].filter(
          isNonEmptyString,
        ),
      ),
    ];

    const [routes, buses, users, runs] = await Promise.all([
      routeIds.length
        ? this.routes.findAll({
            where: { school_id: schoolId, id: { [Op.in]: routeIds } },
            // Names only — the projection below reads nothing else.
            attributes: ['id', 'name', 'code'],
          })
        : Promise.resolve([] as Route[]),
      busIds.length
        ? this.buses.findAll({
            where: { school_id: schoolId, id: { [Op.in]: busIds } },
            attributes: ['id', 'bus_number', 'registration_number'],
          })
        : Promise.resolve([] as Bus[]),
      userIds.length
        ? this.users.findAll({
            where: { school_id: schoolId, id: { [Op.in]: userIds } },
            attributes: ['id', 'first_name', 'last_name'],
          })
        : Promise.resolve([] as User[]),
      runIds.length
        ? this.runs.findAll({
            where: { school_id: schoolId, id: { [Op.in]: runIds } },
            // The run code is the only display field a trip projection needs.
            attributes: ['id', 'code'],
          })
        : Promise.resolve([] as Run[]),
    ]);

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const runById = new Map(runs.map((run) => [run.id, run]));
    const busById = new Map(buses.map((bus) => [bus.id, bus]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return trips.map((trip) => {
      const route = routeById.get(trip.route_id);
      const run = trip.run_id ? runById.get(trip.run_id) : undefined;
      const bus = trip.bus_id ? busById.get(trip.bus_id) : undefined;
      const driver = trip.driver_id ? userById.get(trip.driver_id) : undefined;
      const conductor = trip.conductor_id ? userById.get(trip.conductor_id) : undefined;
      return {
        id: trip.id,
        school_id: trip.school_id,
        route_id: trip.route_id,
        run_id: trip.run_id ?? null,
        bus_id: trip.bus_id ?? null,
        driver_id: trip.driver_id ?? null,
        conductor_id: trip.conductor_id ?? null,
        status: trip.status,
        scheduled_start_at: toIsoString(trip.scheduled_start_at),
        scheduled_end_at: toNullableIsoString(trip.scheduled_end_at),
        actual_start_at: toNullableIsoString(trip.actual_start_at),
        actual_end_at: toNullableIsoString(trip.actual_end_at),
        cancelled_at: toNullableIsoString(trip.cancelled_at),
        cancellation_reason: trip.cancellation_reason ?? null,
        created_at: toIsoString(trip.created_at),
        updated_at: toIsoString(trip.updated_at),
        route_name: route?.name ?? null,
        route_code: route?.code ?? null,
        run_code: run?.code ?? null,
        bus_number: bus?.bus_number ?? null,
        registration_number: bus?.registration_number ?? null,
        driver_name: driver ? `${driver.first_name} ${driver.last_name}`.trim() : null,
        conductor_name: conductor ? `${conductor.first_name} ${conductor.last_name}`.trim() : null,
      };
    });
  }

  /**
   * Builds the search predicate for `findAll`. The trips table carries no
   * names, so the free-text filter first resolves the matching routes, buses
   * and crew members inside the tenant, then pins the trip query to those ids.
   */
  private async buildSearchWhere(
    schoolId: string,
    search: string,
  ): Promise<Array<Record<PropertyKey, unknown>>> {
    const pattern = `%${escapeLikePattern(search)}%`;
    const [routes, buses, users] = await Promise.all([
      this.routes.findAll({
        where: {
          school_id: schoolId,
          [Op.or]: [{ name: { [Op.iLike]: pattern } }, { code: { [Op.iLike]: pattern } }],
        },
        attributes: ['id'],
      }),
      this.buses.findAll({
        where: {
          school_id: schoolId,
          [Op.or]: [
            { registration_number: { [Op.iLike]: pattern } },
            { bus_number: { [Op.iLike]: pattern } },
          ],
        },
        attributes: ['id'],
      }),
      this.users.findAll({
        where: {
          school_id: schoolId,
          [Op.or]: [{ first_name: { [Op.iLike]: pattern } }, { last_name: { [Op.iLike]: pattern } }],
        },
        attributes: ['id'],
      }),
    ]);

    const routeIds = routes.map((route) => route.id);
    const busIds = buses.map((bus) => bus.id);
    const userIds = users.map((user) => user.id);

    const or: Array<Record<PropertyKey, unknown>> = [];
    if (routeIds.length) or.push({ route_id: { [Op.in]: routeIds } });
    if (busIds.length) or.push({ bus_id: { [Op.in]: busIds } });
    if (userIds.length) {
      or.push({ driver_id: { [Op.in]: userIds } });
      or.push({ conductor_id: { [Op.in]: userIds } });
    }
    // A search that matches nothing must not match everything.
    return or.length ? or : [{ id: { [Op.eq]: null } }];
  }
}

/** Inclusive UTC-day window applied to `scheduled_start_at`. */
function buildScheduledRange(query: ListTripsQueryDto): Record<symbol, Date> | null {
  if (query.date !== undefined) {
    const start = startOfUtcDay(query.date);
    return { [Op.gte]: start, [Op.lt]: addDays(start, 1) };
  }

  if (query.date_from === undefined && query.date_to === undefined) {
    return null;
  }

  if (
    query.date_from !== undefined &&
    query.date_to !== undefined &&
    query.date_to < query.date_from
  ) {
    throw new BadRequestException(TRIP_QUERY_DATE_RANGE_MESSAGE);
  }

  const range: Record<symbol, Date> = {};
  if (query.date_from !== undefined) {
    range[Op.gte] = startOfUtcDay(query.date_from);
  }
  if (query.date_to !== undefined) {
    range[Op.lt] = addDays(startOfUtcDay(query.date_to), 1);
  }
  return range;
}

function startOfUtcDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(TRIP_DATE_INVALID_MESSAGE);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(TRIP_DATE_INVALID_MESSAGE);
  }
  return date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseDateTime(value: string | Date): Date {
  const date = toDate(value);
  return date;
}

function parseNullableDateTime(value: string | Date | null | undefined): Date | null {
  return value == null ? null : toDate(value);
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(TRIP_DATE_INVALID_MESSAGE);
  }
  return date;
}

function toNullableDate(value: string | Date | null | undefined): Date | null {
  return value == null ? null : toDate(value);
}

function assertScheduleRange(startAt: Date, endAt: Date | null): void {
  if (endAt !== null && endAt.getTime() < startAt.getTime()) {
    throw new BadRequestException(TRIP_DATE_RANGE_MESSAGE);
  }
}

/** Tenant-local roster periods are compared on the trip's UTC calendar day. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function coversDate(assignment: RouteAssignment, date: string): boolean {
  const from = normalizeDateOnly(assignment.effective_from);
  const to = assignment.effective_to == null ? null : normalizeDateOnly(assignment.effective_to);
  return from <= date && (to === null || date <= to);
}

function normalizeDateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason == null) {
    return null;
  }
  const trimmed = reason.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Inclusive window covering the current UTC calendar day. */
function todayRange(): Record<symbol, Date> {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 86_400_000) };
}

/**
 * `include=minimal` projection of a trip — the raw `trips` row without the
 * resolved display names. Pure and synchronous by design: any query here
 * would defeat the point of the mode.
 */
function toTripMinimalResponse(trip: Trip): TripMinimalResponse {
  return {
    id: trip.id,
    school_id: trip.school_id,
    route_id: trip.route_id,
    run_id: trip.run_id ?? null,
    bus_id: trip.bus_id ?? null,
    driver_id: trip.driver_id ?? null,
    conductor_id: trip.conductor_id ?? null,
    status: trip.status,
    scheduled_start_at: toIsoString(trip.scheduled_start_at),
    scheduled_end_at: toNullableIsoString(trip.scheduled_end_at),
    actual_start_at: toNullableIsoString(trip.actual_start_at),
    actual_end_at: toNullableIsoString(trip.actual_end_at),
    cancelled_at: toNullableIsoString(trip.cancelled_at),
    cancellation_reason: trip.cancellation_reason ?? null,
    created_at: toIsoString(trip.created_at),
    updated_at: toIsoString(trip.updated_at),
  };
}

function toNullableIsoString(value: Date | string | null | undefined): string | null {
  return value == null ? null : toIsoString(value);
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function cloneTripListQuery(query: ListTripsQueryDto): ListTripsQueryDto {
  const clone = new ListTripsQueryDto();
  clone.page = query.page;
  clone.limit = query.limit;
  clone.search = query.search;
  clone.status = query.status;
  clone.route_id = query.route_id;
  clone.run_id = query.run_id;
  clone.bus_id = query.bus_id;
  clone.driver_id = query.driver_id;
  clone.conductor_id = query.conductor_id;
  clone.date = query.date;
  clone.date_from = query.date_from;
  clone.date_to = query.date_to;
  clone.include = query.include;
  return clone;
}

function emptyTripList(query: ListTripsQueryDto): TripListResponse {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return {
    items: [],
    meta: {
      page,
      limit,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: page > 1,
    },
  };
}
