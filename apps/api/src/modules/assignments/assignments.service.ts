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
  RouteAssignmentDeleteResponse,
  RouteAssignmentListResponse,
  RouteAssignmentResponse,
  RouteAssignmentRole,
} from '@school-bus-tracking/shared-types';
import { Bus, Route, RouteAssignment, User } from '../../database/models';
import {
  ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_BUS_INVALID_MESSAGE,
  ROUTE_ASSIGNMENT_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_DATE_INVALID_MESSAGE,
  ROUTE_ASSIGNMENT_DATE_RANGE_MESSAGE,
  ROUTE_ASSIGNMENT_DELETED_MESSAGE,
  ROUTE_ASSIGNMENT_INACTIVE_RESOURCE_MESSAGE,
  ROUTE_ASSIGNMENT_NOT_FOUND_MESSAGE,
  ROUTE_ASSIGNMENT_ROLE_INVALID_MESSAGE,
  ROUTE_ASSIGNMENT_ROLE_MISMATCH_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_INVALID_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_USER_INVALID_MESSAGE,
  ROUTE_ASSIGNMENTS_BUSES_REPOSITORY,
  ROUTE_ASSIGNMENTS_REPOSITORY,
  ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY,
  ROUTE_ASSIGNMENTS_USERS_REPOSITORY,
} from './assignments.constants';
import { CreateRouteAssignmentDto } from './dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from './dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from './dto/update-route-assignment.dto';

/**
 * Tenant-safe route roster management.
 *
 * `RouteAssignment` deliberately stores one row per person and role. A route
 * with a driver and conductor therefore has two rows sharing the same route,
 * bus and effective period. Every related-resource lookup is pinned to the
 * JWT-derived school id, and active period conflicts are checked before a
 * write. No request body can select a tenant or an arbitrary User role.
 */
@Injectable()
export class RouteAssignmentsService {
  constructor(
    @Inject(ROUTE_ASSIGNMENTS_REPOSITORY)
    private readonly assignments: typeof RouteAssignment,
    @Inject(ROUTE_ASSIGNMENTS_ROUTES_REPOSITORY)
    private readonly routes: typeof Route,
    @Inject(ROUTE_ASSIGNMENTS_BUSES_REPOSITORY)
    private readonly buses: typeof Bus,
    @Inject(ROUTE_ASSIGNMENTS_USERS_REPOSITORY)
    private readonly users: typeof User,
  ) {}

  /** Creates one DRIVER or CONDUCTOR roster row in the JWT tenant. */
  async create(schoolId: string, dto: CreateRouteAssignmentDto): Promise<RouteAssignmentResponse> {
    const values = this.normalizedCreateValues(dto);
    await this.assertRelatedResources(
      schoolId,
      values.route_id,
      values.bus_id,
      values.user_id,
      values.role,
      values.is_active,
    );
    await this.assertNoActiveConflict(schoolId, values, undefined);

    try {
      const assignment = await this.assignments.create({ school_id: schoolId, ...values });
      return this.toResponse(assignment);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ROUTE_ASSIGNMENT_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }

  /** Lists assignments of the authenticated school only. */
  async findAll(
    schoolId: string,
    query: ListRouteAssignmentsQueryDto,
  ): Promise<RouteAssignmentListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = { school_id: schoolId };

    if (query.route_id !== undefined) where.route_id = query.route_id;
    if (query.bus_id !== undefined) where.bus_id = query.bus_id;
    if (query.user_id !== undefined) where.user_id = query.user_id;
    if (query.role !== undefined) where.role = query.role;
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const search = query.search?.trim();
    if (search) {
      where[Op.or] = await this.buildSearchWhere(schoolId, search);
    }

    const { rows, count } = await this.assignments.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['effective_from', 'DESC'],
        ['route_id', 'ASC'],
        ['role', 'ASC'],
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
      items: await this.toResponses(rows),
      meta,
    };
  }

  /** Returns an assignment only when its id and school both match. */
  async findOne(schoolId: string, id: string): Promise<RouteAssignmentResponse> {
    const assignment = await this.findAssignmentOrThrow(schoolId, id);
    return this.toResponse(assignment);
  }

  /**
   * Updates an assignment in place. Role and user may change, but the
   * resulting user/role pair and all related-resource tenant checks are
   * validated again before the update is written.
   */
  async update(
    schoolId: string,
    id: string,
    dto: UpdateRouteAssignmentDto,
  ): Promise<RouteAssignmentResponse> {
    const assignment = await this.findAssignmentOrThrow(schoolId, id);
    const values = this.normalizedUpdateValues(assignment, dto);

    await this.assertRelatedResources(
      schoolId,
      values.route_id,
      values.bus_id,
      values.user_id,
      values.role,
      values.is_active,
    );
    await this.assertNoActiveConflict(schoolId, values, id);

    try {
      await assignment.update(values);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ROUTE_ASSIGNMENT_CONFLICT_MESSAGE);
      }
      throw error;
    }

    return this.toResponse(assignment);
  }

  /** Soft-deletes an assignment while retaining roster history. */
  async remove(schoolId: string, id: string): Promise<RouteAssignmentDeleteResponse> {
    const assignment = await this.findAssignmentOrThrow(schoolId, id);
    await assignment.destroy();
    return { id, message: ROUTE_ASSIGNMENT_DELETED_MESSAGE };
  }

  private async findAssignmentOrThrow(schoolId: string, id: string): Promise<RouteAssignment> {
    const assignment = await this.assignments.findOne({
      where: { id, school_id: schoolId },
    });
    if (!assignment) {
      throw new NotFoundException(ROUTE_ASSIGNMENT_NOT_FOUND_MESSAGE);
    }
    return assignment;
  }

  /**
   * Validates every reference against the authenticated tenant. Related
   * records from another school intentionally produce the same generic 400 as
   * missing records so their existence is not disclosed.
   */
  private async assertRelatedResources(
    schoolId: string,
    routeId: string,
    busId: string | null,
    userId: string,
    role: RouteAssignmentRole,
    isActive: boolean,
  ): Promise<void> {
    if (!isRouteAssignmentRole(role)) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_ROLE_INVALID_MESSAGE);
    }

    const route = await this.routes.findOne({
      where: { id: routeId, school_id: schoolId },
    });
    if (!route) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_ROUTE_INVALID_MESSAGE);
    }

    if (busId === null) {
      if (isActive) {
        throw new BadRequestException(ROUTE_ASSIGNMENT_BUS_INVALID_MESSAGE);
      }
    } else {
      const bus = await this.buses.findOne({
        where: { id: busId, school_id: schoolId },
      });
      if (!bus) {
        throw new BadRequestException(ROUTE_ASSIGNMENT_BUS_INVALID_MESSAGE);
      }
      if (isActive && (route.is_active === false || bus.is_active === false)) {
        throw new BadRequestException(ROUTE_ASSIGNMENT_INACTIVE_RESOURCE_MESSAGE);
      }
    }

    const user = await this.users.findOne({
      where: { id: userId, school_id: schoolId },
    });
    if (!user) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_USER_INVALID_MESSAGE);
    }
    if (String(user.role) !== role) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_ROLE_MISMATCH_MESSAGE);
    }
    if (isActive && (route.is_active === false || user.is_active === false)) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_INACTIVE_RESOURCE_MESSAGE);
    }
  }

  /**
   * Checks period overlap for active assignments.
   *
   * Two crew rows on the same route and bus are expected (DRIVER + CONDUCTOR).
   * A route may not have two people in the same role, a route may not switch
   * buses during an overlapping period, and a bus may not serve two routes at
   * once. A staff member can serve several routes over time, matching the
   * existing RouteAssignment model's documented roster semantics.
   */
  private async assertNoActiveConflict(
    schoolId: string,
    values: AssignmentValues,
    excludeId: string | undefined,
  ): Promise<void> {
    if (!values.is_active) {
      return;
    }

    const existingAssignments = await this.assignments.findAll({
      where: { school_id: schoolId, is_active: true },
    });

    for (const existing of existingAssignments) {
      if (excludeId && existing.id === excludeId) {
        continue;
      }
      if (existing.is_active === false || !periodsOverlap(values, existing)) {
        continue;
      }

      if (existing.route_id === values.route_id && existing.role === values.role) {
        throw new ConflictException(ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE);
      }

      if (
        existing.route_id === values.route_id &&
        existing.bus_id !== null &&
        values.bus_id !== null &&
        existing.bus_id !== values.bus_id
      ) {
        throw new ConflictException(ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE);
      }

      if (
        existing.bus_id !== null &&
        values.bus_id !== null &&
        existing.bus_id === values.bus_id &&
        existing.route_id !== values.route_id
      ) {
        throw new ConflictException(ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE);
      }
    }
  }

  private normalizedCreateValues(dto: CreateRouteAssignmentDto): AssignmentValues {
    const role = dto.role;
    if (!isRouteAssignmentRole(role)) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_ROLE_INVALID_MESSAGE);
    }

    const effectiveFrom = normalizeDateOnly(dto.effective_from);
    const effectiveTo = normalizeNullableDateOnly(dto.effective_to);
    assertDateRange(effectiveFrom, effectiveTo);

    if (!dto.route_id || !dto.bus_id || !dto.user_id) {
      throw new BadRequestException('route_id, bus_id and user_id are required');
    }

    return {
      route_id: dto.route_id,
      bus_id: dto.bus_id,
      user_id: dto.user_id,
      role,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      is_active: dto.is_active ?? true,
    };
  }

  private normalizedUpdateValues(
    assignment: RouteAssignment,
    dto: UpdateRouteAssignmentDto,
  ): AssignmentValues {
    const routeId = dto.route_id ?? assignment.route_id;
    const busId = dto.bus_id === undefined ? assignment.bus_id : dto.bus_id;
    const userId = dto.user_id ?? assignment.user_id;
    const role = dto.role ?? assignment.role;
    const effectiveFrom = normalizeDateOnly(dto.effective_from ?? assignment.effective_from);
    const effectiveTo =
      dto.effective_to === undefined
        ? normalizeNullableDateOnly(assignment.effective_to)
        : normalizeNullableDateOnly(dto.effective_to);
    const isActive = dto.is_active ?? assignment.is_active;

    if (!routeId || !userId) {
      throw new BadRequestException('route_id and user_id are required');
    }
    if (!isRouteAssignmentRole(role)) {
      throw new BadRequestException(ROUTE_ASSIGNMENT_ROLE_INVALID_MESSAGE);
    }
    assertDateRange(effectiveFrom, effectiveTo);

    return {
      route_id: routeId,
      bus_id: busId,
      user_id: userId,
      role,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      is_active: isActive,
    };
  }

  /**
   * Explicit projection — ORM internals and associations never leak. Route,
   * bus and crew-member names are resolved with batched lookups so callers get
   * human-readable values, never bare ids.
   */
  private async toResponse(assignment: RouteAssignment): Promise<RouteAssignmentResponse> {
    const [response] = await this.toResponses([assignment]);
    return response;
  }

  /** Batched projection of assignments with their route / bus / crew names. */
  private async toResponses(assignments: RouteAssignment[]): Promise<RouteAssignmentResponse[]> {
    if (assignments.length === 0) {
      return [];
    }
    const schoolId = assignments[0].school_id;
    const routeIds = [...new Set(assignments.map((assignment) => assignment.route_id))];
    const busIds = [
      ...new Set(assignments.map((assignment) => assignment.bus_id).filter(isId)),
    ];
    const userIds = [...new Set(assignments.map((assignment) => assignment.user_id))];

    const [routes, buses, users] = await Promise.all([
      routeIds.length
        ? this.routes.findAll({ where: { school_id: schoolId, id: { [Op.in]: routeIds } } })
        : Promise.resolve([] as Route[]),
      busIds.length
        ? this.buses.findAll({ where: { school_id: schoolId, id: { [Op.in]: busIds } } })
        : Promise.resolve([] as Bus[]),
      userIds.length
        ? this.users.findAll({ where: { school_id: schoolId, id: { [Op.in]: userIds } } })
        : Promise.resolve([] as User[]),
    ]);

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const busById = new Map(buses.map((bus) => [bus.id, bus]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return assignments.map((assignment) => {
      const route = routeById.get(assignment.route_id);
      const bus = assignment.bus_id ? busById.get(assignment.bus_id) : undefined;
      const user = userById.get(assignment.user_id);
      return {
        id: assignment.id,
        school_id: assignment.school_id,
        route_id: assignment.route_id,
        bus_id: assignment.bus_id,
        user_id: assignment.user_id,
        role: assignment.role,
        effective_from: normalizeDateOnly(assignment.effective_from),
        effective_to: normalizeNullableDateOnly(assignment.effective_to),
        is_active: assignment.is_active,
        created_at: toIsoString(assignment.created_at),
        updated_at: toIsoString(assignment.updated_at),
        route_name: route?.name ?? null,
        route_code: route?.code ?? null,
        bus_number: bus?.bus_number ?? null,
        bus_registration_number: bus?.registration_number ?? null,
        user_name: user ? `${user.first_name} ${user.last_name}`.trim() : null,
        user_email: user?.email ?? null,
      };
    });
  }

  /**
   * Builds the search predicate. The roster table carries no names, so the
   * free-text filter first resolves the matching routes, buses and crew members
   * inside the tenant, then pins the assignment query to those ids.
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

    const or: Array<Record<PropertyKey, unknown>> = [];
    const routeIds = routes.map((route) => route.id);
    const busIds = buses.map((bus) => bus.id);
    const userIds = users.map((user) => user.id);
    if (routeIds.length) or.push({ route_id: { [Op.in]: routeIds } });
    if (busIds.length) or.push({ bus_id: { [Op.in]: busIds } });
    if (userIds.length) or.push({ user_id: { [Op.in]: userIds } });
    return or.length ? or : [{ id: { [Op.eq]: null } }];
  }
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

interface AssignmentValues {
  route_id: string;
  bus_id: string | null;
  user_id: string;
  role: RouteAssignmentRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

function isRouteAssignmentRole(value: unknown): value is RouteAssignmentRole {
  return value === RouteAssignmentRole.DRIVER || value === RouteAssignmentRole.CONDUCTOR;
}

function normalizeDateOnly(value: string | Date | null | undefined): string {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new BadRequestException(ROUTE_ASSIGNMENT_DATE_INVALID_MESSAGE);
  }

  const candidate = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    throw new BadRequestException(ROUTE_ASSIGNMENT_DATE_INVALID_MESSAGE);
  }

  const [year, month, day] = candidate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(ROUTE_ASSIGNMENT_DATE_INVALID_MESSAGE);
  }
  return candidate;
}

function normalizeNullableDateOnly(value: string | Date | null | undefined): string | null {
  return value == null ? null : normalizeDateOnly(value);
}

function assertDateRange(effectiveFrom: string, effectiveTo: string | null): void {
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new BadRequestException(ROUTE_ASSIGNMENT_DATE_RANGE_MESSAGE);
  }
}

function periodsOverlap(values: AssignmentValues, existing: RouteAssignment): boolean {
  const existingFrom = normalizeDateOnly(existing.effective_from);
  const existingTo = normalizeNullableDateOnly(existing.effective_to);
  const valuesEnd = values.effective_to ?? '9999-12-31';
  const existingEnd = existingTo ?? '9999-12-31';
  return values.effective_from <= existingEnd && existingFrom <= valuesEnd;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Short alias for consumers that refer to the feature as assignments. */
export { RouteAssignmentsService as AssignmentsService };
