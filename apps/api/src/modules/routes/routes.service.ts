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
  PlanLimitResource,
  RouteAssignmentRole,
  RouteDeleteResponse,
  RouteDetailResponse,
  RouteListResponse,
  RouteResponse,
  RouteStopsListResponse,
  RouteStudentSummary,
  StopResponse,
  TripResponse,
  TripStatus,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  Route,
  RouteAssignment,
  RouteAttributes,
  Stop,
  Student,
  Trip,
  User,
} from '../../database/models';
import {
  ROUTE_CODE_TAKEN_MESSAGE,
  ROUTE_DELETED_MESSAGE,
  ROUTE_NOT_FOUND_MESSAGE,
  ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE,
  ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE,
  ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE,
  ROUTES_BUSES_REPOSITORY,
  ROUTES_REPOSITORY,
  ROUTES_ROUTE_ASSIGNMENTS_REPOSITORY,
  ROUTES_STOPS_REPOSITORY,
  ROUTES_STUDENTS_REPOSITORY,
  ROUTES_TRIPS_REPOSITORY,
  ROUTES_USERS_REPOSITORY,
} from './routes.constants';
import { CreateRouteDto } from './dto/create-route.dto';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { PlanLimitsService } from '../../common/plan-limits';

/**
 * Tenant-safe route management.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Route not found` as a missing record — the existence
 * of another school's route is never revealed.
 *
 * Route stop manifests are managed here as well: `GET /routes/:id/stops`
 * returns the ordered boarding points and `PUT /routes/:id/stops` renumbers
 * them from the supplied permutation. Both are pinned to the authenticated
 * school through the route lookup.
 */
/** Ranked preference for the route's "current" trip today. */
const TRIP_PREFERENCE: Record<TripStatus, number> = {
  [TripStatus.IN_PROGRESS]: 0,
  [TripStatus.BOARDING]: 1,
  [TripStatus.SCHEDULED]: 2,
  [TripStatus.COMPLETED]: 3,
  [TripStatus.CANCELLED]: 4,
};

@Injectable()
export class RoutesService {
  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly routes: typeof Route,
    @Inject(ROUTES_STOPS_REPOSITORY) private readonly stops: typeof Stop,
    @Inject(ROUTES_ROUTE_ASSIGNMENTS_REPOSITORY)
    private readonly assignments: typeof RouteAssignment,
    @Inject(ROUTES_USERS_REPOSITORY) private readonly users: typeof User,
    @Inject(ROUTES_BUSES_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(ROUTES_TRIPS_REPOSITORY) private readonly trips: typeof Trip,
    @Inject(ROUTES_STUDENTS_REPOSITORY) private readonly students: typeof Student,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * Creates a route inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input. The route code is unique per tenant (soft-deleted rows release
   * their code).
   */
  async create(schoolId: string, dto: CreateRouteDto): Promise<RouteResponse> {
    return this.planLimits.runWithinLimit(
      schoolId,
      PlanLimitResource.ROUTES,
      async (transaction) => {
        const code = dto.code.trim();
        await this.assertCodeFree(schoolId, code);

        try {
          const route = await this.routes.create(
            {
              school_id: schoolId,
              name: dto.name.trim(),
              code,
              description: nullableTrim(dto.description),
              is_active: dto.is_active ?? true,
            },
            transaction ? { transaction } : {},
          );
          const [response] = await this.toRouteResponses([route]);
          return response;
        } catch (error) {
          if (error instanceof UniqueConstraintError) {
            throw new ConflictException(ROUTE_CODE_TAKEN_MESSAGE);
          }
          throw error;
        }
      },
    );
  }

  /**
   * Lists routes of the authenticated school only, with pagination and an
   * optional case-insensitive search over name / code. No other tenant's rows
   * can match because `school_id` is always part of the where clause.
   */
  async findAll(schoolId: string, query: ListRoutesQueryDto): Promise<RouteListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [{ name: { [Op.iLike]: pattern } }, { code: { [Op.iLike]: pattern } }];
    }

    const { rows, count } = await this.routes.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['name', 'ASC'],
        ['code', 'ASC'],
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

    return {
      items: await this.toRouteResponses(rows),
      meta,
    };
  }

  /** Returns one route only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<RouteResponse> {
    const route = await this.findRouteOrThrow(schoolId, id);
    const [response] = await this.toRouteResponses([route]);
    return response;
  }

  /**
   * `GET /api/v1/routes/:id/details`
   *
   * Full route-detail payload: enriched route facts plus the ordered stops,
   * the students whose home stop belongs to the route and the route's active
   * trip today (if any).
   */
  async getDetails(schoolId: string, id: string): Promise<RouteDetailResponse> {
    const route = await this.findOne(schoolId, id);

    const [stops, , todayTrips] = await Promise.all([
      this.stops.findAll({
        where: { route_id: id, school_id: schoolId },
        order: [['sequence_number', 'ASC']],
      }),
      this.assignments.findAll({
        where: { route_id: id, school_id: schoolId, is_active: true },
        order: [['effective_from', 'ASC']],
      }),
      this.trips.findAll({
        where: { route_id: id, school_id: schoolId, scheduled_start_at: todayRange() },
        order: [['scheduled_start_at', 'ASC']],
      }),
    ]);

    const stopById = new Map(stops.map((stop) => [stop.id, stop]));
    const students = stops.length
      ? await this.students.findAll({
          where: {
            school_id: schoolId,
            home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
            is_active: true,
          },
          order: [
            ['last_name', 'ASC'],
            ['first_name', 'ASC'],
          ],
        })
      : [];

    const activeTrip = pickTodayTrip(todayTrips);
    let activeTripResponse: TripResponse | null = null;
    if (activeTrip) {
      const crewIds = [activeTrip.driver_id, activeTrip.conductor_id].filter(isId);
      const busIds = [activeTrip.bus_id].filter(isId);
      const [crew, buses] = await Promise.all([
        crewIds.length
          ? this.users.findAll({ where: { school_id: schoolId, id: { [Op.in]: crewIds } } })
          : Promise.resolve([] as User[]),
        busIds.length
          ? this.buses.findAll({ where: { school_id: schoolId, id: { [Op.in]: busIds } } })
          : Promise.resolve([] as Bus[]),
      ]);
      activeTripResponse = toTripResponse(activeTrip, crew, buses, route);
    }

    return {
      route,
      stops: stops.map((stop) => this.toStopResponse(stop)),
      students: students.map(
        (student): RouteStudentSummary => {
          const stop = student.home_stop_id ? stopById.get(student.home_stop_id) : undefined;
          return {
            id: student.id,
            admission_number: student.admission_number,
            first_name: student.first_name,
            last_name: student.last_name,
            grade_level: student.grade_level,
            stop_id: student.home_stop_id,
            stop_name: stop?.name ?? null,
            stop_sequence_number: stop?.sequence_number ?? null,
          };
        },
      ),
      active_trip: activeTripResponse,
    };
  }

  /**
   * Partial update of a route that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written by this method. Explicit `null` clears the
   * nullable `description`.
   */
  async update(schoolId: string, id: string, dto: UpdateRouteDto): Promise<RouteResponse> {
    const route = await this.findRouteOrThrow(schoolId, id);

    const updates: Partial<RouteAttributes> = {};
    if (dto.name !== undefined) {
      updates.name = dto.name.trim();
    }
    if (dto.code !== undefined) {
      updates.code = dto.code.trim();
      await this.assertCodeFree(schoolId, updates.code, id);
    }
    if (dto.description !== undefined) {
      updates.description = nullableTrim(dto.description);
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await route.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ROUTE_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }

    const [response] = await this.toRouteResponses([route]);
    return response;
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a route of the
   * authenticated school. Records are never physically removed.
   */
  async remove(schoolId: string, id: string): Promise<RouteDeleteResponse> {
    const route = await this.findRouteOrThrow(schoolId, id);
    await route.destroy();
    return { id, message: ROUTE_DELETED_MESSAGE };
  }

  /**
   * `GET /api/v1/routes/:id/stops`
   *
   * Returns the route's active stops ordered by `sequence_number`. Both the
   * route and the stops are pinned to the authenticated school.
   */
  async findRouteStops(schoolId: string, routeId: string): Promise<RouteStopsListResponse> {
    await this.findRouteOrThrow(schoolId, routeId);

    const stops = await this.stops.findAll({
      where: { route_id: routeId, school_id: schoolId },
      order: [['sequence_number', 'ASC']],
    });

    return { items: stops.map((stop) => this.toStopResponse(stop)) };
  }

  /**
   * `PUT /api/v1/routes/:id/stops`
   *
   * Renumbers the route's active stops 1..N from the supplied permutation.
   *
   * The payload must list every active stop of the route exactly once
   * (unknown, duplicate or missing ids are rejected with 400). Renumbering
   * happens inside a transaction and first moves every stop to a temporary
   * negative position so that swaps never collide with the per-route unique
   * sequence constraint.
   */
  async reorderRouteStops(
    schoolId: string,
    routeId: string,
    dto: ReorderRouteStopsDto,
  ): Promise<RouteStopsListResponse> {
    await this.findRouteOrThrow(schoolId, routeId);

    const stops = await this.stops.findAll({
      where: { route_id: routeId, school_id: schoolId },
    });
    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));
    const ids = dto.stop_ids;

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(ROUTE_STOPS_ORDER_DUPLICATE_MESSAGE);
    }
    if (ids.length !== stops.length) {
      throw new BadRequestException(ROUTE_STOPS_ORDER_INCOMPLETE_MESSAGE);
    }
    for (const id of ids) {
      if (!stopsById.has(id)) {
        throw new BadRequestException(ROUTE_STOPS_ORDER_UNKNOWN_STOP_MESSAGE);
      }
    }

    const sequelize = this.stops.sequelize;
    if (!sequelize) {
      throw new Error('Sequelize instance is unavailable for stop reordering');
    }

    await sequelize.transaction(async (transaction) => {
      // Phase 1: move every stop to a temporary unique position so the final
      // writes below can never collide on (route_id, sequence_number).
      for (const stop of stops) {
        await stop.update({ sequence_number: -stop.sequence_number }, { transaction });
      }
      // Phase 2: write the requested 1..N positions.
      for (let index = 0; index < ids.length; index += 1) {
        const stop = stopsById.get(ids[index]);
        if (stop) {
          await stop.update({ sequence_number: index + 1 }, { transaction });
        }
      }
    });

    const ordered = ids.map((id) => {
      const stop = stopsById.get(id);
      return stop ? this.toStopResponse(stop) : null;
    });
    return { items: ordered.filter((stop): stop is StopResponse => stop !== null) };
  }

  private async findRouteOrThrow(schoolId: string, id: string): Promise<Route> {
    const route = await this.routes.findOne({
      where: { id, school_id: schoolId },
    });
    if (!route) {
      throw new NotFoundException(ROUTE_NOT_FOUND_MESSAGE);
    }
    return route;
  }

  /** Rejects a code already used by another active route of the same school;
   * `excludeId` lets updates skip the row being edited. */
  private async assertCodeFree(schoolId: string, code: string, excludeId?: string): Promise<void> {
    const where: Record<PropertyKey, unknown> = { school_id: schoolId, code };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.routes.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(ROUTE_CODE_TAKEN_MESSAGE);
    }
  }

  /**
   * Explicit field-by-field projection — no internal or sensitive field leaks.
   * The rostered crew, bus, student count and today's trip status are resolved
   * with batched lookups so callers get names, never bare ids.
   */
  private async toRouteResponses(routes: Route[]): Promise<RouteResponse[]> {
    if (routes.length === 0) {
      return [];
    }
    const schoolId = routes[0].school_id;
    const routeIds = routes.map((route) => route.id);

    const [assignments, stops, todayTrips] = await Promise.all([
      this.assignments.findAll({
        where: { school_id: schoolId, route_id: { [Op.in]: routeIds }, is_active: true },
        order: [['effective_from', 'ASC']],
      }),
      this.stops.findAll({
        where: { school_id: schoolId, route_id: { [Op.in]: routeIds }, is_active: true },
      }),
      this.trips.findAll({
        where: { school_id: schoolId, route_id: { [Op.in]: routeIds }, scheduled_start_at: todayRange() },
        order: [['scheduled_start_at', 'ASC']],
      }),
    ]);

    const userIds = [...new Set(assignments.map((assignment) => assignment.user_id))];
    const busIds = [...new Set(assignments.map((assignment) => assignment.bus_id).filter(isId))];
    const [users, buses] = await Promise.all([
      userIds.length
        ? this.users.findAll({ where: { school_id: schoolId, id: { [Op.in]: userIds } } })
        : Promise.resolve([] as User[]),
      busIds.length
        ? this.buses.findAll({ where: { school_id: schoolId, id: { [Op.in]: busIds } } })
        : Promise.resolve([] as Bus[]),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const busById = new Map(buses.map((bus) => [bus.id, bus]));

    const stopIds = [...new Set(stops.map((stop) => stop.id))];
    const students = stopIds.length
      ? await this.students.findAll({
          where: { school_id: schoolId, home_stop_id: { [Op.in]: stopIds }, is_active: true },
        })
      : [];
    const stopRoute = new Map(stops.map((stop) => [stop.id, stop.route_id]));
    const countByRoute = new Map<string, number>();
    for (const student of students) {
      if (!student.home_stop_id) continue;
      const routeId = stopRoute.get(student.home_stop_id);
      if (!routeId) continue;
      countByRoute.set(routeId, (countByRoute.get(routeId) ?? 0) + 1);
    }

    const assignmentByRoute = new Map<string, RouteAssignment[]>();
    for (const assignment of assignments) {
      const list = assignmentByRoute.get(assignment.route_id) ?? [];
      list.push(assignment);
      assignmentByRoute.set(assignment.route_id, list);
    }
    const tripByRoute = new Map<string, Trip>();
    for (const trip of todayTrips) {
      const current = tripByRoute.get(trip.route_id);
      const better =
        !current ||
        TRIP_PREFERENCE[trip.status] < TRIP_PREFERENCE[current.status] ||
        (TRIP_PREFERENCE[trip.status] === TRIP_PREFERENCE[current.status] &&
          trip.scheduled_start_at.getTime() < current.scheduled_start_at.getTime());
      if (better) tripByRoute.set(trip.route_id, trip);
    }

    return routes.map((route) => {
      const roster = assignmentByRoute.get(route.id) ?? [];
      const driverRow = roster.find((assignment) => assignment.role === RouteAssignmentRole.DRIVER);
      const conductorRow = roster.find(
        (assignment) => assignment.role === RouteAssignmentRole.CONDUCTOR,
      );
      const driver = driverRow ? userById.get(driverRow.user_id) : undefined;
      const conductor = conductorRow ? userById.get(conductorRow.user_id) : undefined;
      const bus = roster[0]?.bus_id ? busById.get(roster[0].bus_id) : undefined;
      return {
        id: route.id,
        school_id: route.school_id,
        name: route.name,
        code: route.code,
        description: route.description,
        is_active: route.is_active,
        created_at: route.created_at.toISOString(),
        updated_at: route.updated_at.toISOString(),
        driver_name: driver ? `${driver.first_name} ${driver.last_name}`.trim() : null,
        conductor_name: conductor ? `${conductor.first_name} ${conductor.last_name}`.trim() : null,
        bus_number: bus?.bus_number ?? null,
        bus_registration_number: bus?.registration_number ?? null,
        student_count: countByRoute.get(route.id) ?? 0,
        current_trip_status: tripByRoute.get(route.id)?.status ?? null,
      };
    });
  }

  /** Explicit field-by-field projection of a stop (route manifest responses). */
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
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Inclusive window covering the current UTC calendar day. */
function todayRange(): Record<symbol, Date> {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 86_400_000) };
}

/** Picks the single \"current\" trip for a route (active runs win, then earliest). */
function pickTodayTrip(trips: Trip[]): Trip | null {
  if (trips.length === 0) return null;
  return [...trips].sort((a, b) => {
    const rank = TRIP_PREFERENCE[a.status] - TRIP_PREFERENCE[b.status];
    if (rank !== 0) return rank;
    return a.scheduled_start_at.getTime() - b.scheduled_start_at.getTime();
  })[0];
}

/** Minimal trip projection with display names resolved from the loaded maps. */
function toTripResponse(
  trip: Trip,
  users: User[],
  buses: Bus[],
  route: { name: string; code: string },
): TripResponse {
  const userById = new Map(users.map((user) => [user.id, user]));
  const bus = buses.find((candidate) => candidate.id === trip.bus_id);
  const driver = trip.driver_id ? userById.get(trip.driver_id) : undefined;
  const conductor = trip.conductor_id ? userById.get(trip.conductor_id) : undefined;
  const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
  return {
    id: trip.id,
    school_id: trip.school_id,
    route_id: trip.route_id,
    bus_id: trip.bus_id ?? null,
    driver_id: trip.driver_id ?? null,
    conductor_id: trip.conductor_id ?? null,
    status: trip.status,
    scheduled_start_at: trip.scheduled_start_at.toISOString(),
    scheduled_end_at: iso(trip.scheduled_end_at),
    actual_start_at: iso(trip.actual_start_at),
    actual_end_at: iso(trip.actual_end_at),
    cancelled_at: iso(trip.cancelled_at),
    cancellation_reason: trip.cancellation_reason ?? null,
    created_at: trip.created_at.toISOString(),
    updated_at: trip.updated_at.toISOString(),
    route_name: route.name,
    route_code: route.code,
    bus_number: bus?.bus_number ?? null,
    registration_number: bus?.registration_number ?? null,
    driver_name: driver ? `${driver.first_name} ${driver.last_name}`.trim() : null,
    conductor_name: conductor ? `${conductor.first_name} ${conductor.last_name}`.trim() : null,
  };
}
