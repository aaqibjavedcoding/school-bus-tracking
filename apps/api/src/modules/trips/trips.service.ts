import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  RouteAssignmentRole,
  TripDeleteResponse,
  TripListResponse,
  TripResponse,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { isTripStatusTransitionAllowed } from '@school-bus-tracking/validation';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
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
  TRIP_DRIVER_INVALID_MESSAGE,
  TRIP_DRIVER_MISSING_MESSAGE,
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

/** Resources a trip is dispatched with, derived from a roster row. */
interface DispatchTarget {
  route_id: string;
  bus_id: string;
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
 * connected sockets. The transition rules themselves are untouched.
 */
@Injectable()
export class TripsService {
  constructor(
    @Inject(TRIPS_REPOSITORY)
    private readonly trips: typeof Trip,
    @Inject(TRIPS_ROUTE_ASSIGNMENTS_REPOSITORY)
    private readonly assignments: typeof RouteAssignment,
    @Inject(TRIPS_ROUTES_REPOSITORY)
    private readonly routes: typeof Route,
    @Inject(TRIPS_BUSES_REPOSITORY)
    private readonly buses: typeof Bus,
    @Inject(TRIPS_USERS_REPOSITORY)
    private readonly users: typeof User,
    private readonly liveTracking: LiveTrackingService,
  ) {}

  /** Dispatches a new `SCHEDULED` trip from an active roster row. */
  async create(schoolId: string, dto: CreateTripDto): Promise<TripResponse> {
    const scheduledStartAt = parseDateTime(dto.scheduled_start_at);
    const scheduledEndAt = parseNullableDateTime(dto.scheduled_end_at);
    assertScheduleRange(scheduledStartAt, scheduledEndAt);

    const target = await this.resolveDispatchTarget(
      schoolId,
      dto.route_assignment_id,
      scheduledStartAt,
    );
    await this.assertNoScheduleConflict(schoolId, target.route_id, scheduledStartAt, undefined);

    try {
      const trip = await this.trips.create({
        school_id: schoolId,
        route_id: target.route_id,
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

  /** Lists trips of the authenticated school only. */
  async findAll(schoolId: string, query: ListTripsQueryDto): Promise<TripListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = { school_id: schoolId };

    if (query.status !== undefined) where.status = query.status;
    if (query.route_id !== undefined) where.route_id = query.route_id;
    if (query.bus_id !== undefined) where.bus_id = query.bus_id;
    if (query.driver_id !== undefined) where.driver_id = query.driver_id;
    if (query.conductor_id !== undefined) where.conductor_id = query.conductor_id;

    const scheduledRange = buildScheduledRange(query);
    if (scheduledRange) where.scheduled_start_at = scheduledRange;

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

    return { items: rows.map((trip) => this.toResponse(trip)), meta };
  }

  /** Returns a trip only when its id and school both match. */
  async findOne(schoolId: string, id: string): Promise<TripResponse> {
    const trip = await this.findTripOrThrow(schoolId, id);
    return this.toResponse(trip);
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

    let routeId = trip.route_id;
    if (dto.route_assignment_id !== undefined) {
      const target = await this.resolveDispatchTarget(
        schoolId,
        dto.route_assignment_id,
        scheduledStartAt,
      );
      routeId = target.route_id;
      values.route_id = target.route_id;
      values.bus_id = target.bus_id;
      values.driver_id = target.driver_id;
      values.conductor_id = target.conductor_id;
    }

    await this.assertNoScheduleConflict(schoolId, routeId, scheduledStartAt, id);

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
   * Derives and validates the dispatch snapshot from a roster row.
   *
   * Every lookup is pinned to the JWT tenant, so a roster row, route, bus or
   * crew member from another school produces the same generic 400 as a
   * non-existent one and never leaks its existence.
   */
  private async resolveDispatchTarget(
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
      route_id: assignment.route_id,
      bus_id: assignment.bus_id,
      driver_id: driverId,
      conductor_id: conductorId,
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

  /** Mirrors the `uq_trips_route_scheduled_start` partial unique index. */
  private async assertNoScheduleConflict(
    schoolId: string,
    routeId: string,
    scheduledStartAt: Date,
    excludeId: string | undefined,
  ): Promise<void> {
    const existing = await this.trips.findOne({
      where: {
        school_id: schoolId,
        route_id: routeId,
        scheduled_start_at: scheduledStartAt,
      } as WhereOptions,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(TRIP_CONFLICT_MESSAGE);
    }
  }

  /** Explicit projection — ORM internals and associations never leak. */
  private toResponse(trip: Trip): TripResponse {
    return {
      id: trip.id,
      school_id: trip.school_id,
      route_id: trip.route_id,
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

function toNullableIsoString(value: Date | string | null | undefined): string | null {
  return value == null ? null : toIsoString(value);
}
