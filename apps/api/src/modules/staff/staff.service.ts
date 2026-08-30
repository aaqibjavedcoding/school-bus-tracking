import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  StaffResponse,
  StaffRole,
  StaffListResponse,
  StaffDeleteResponse,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { hashPassword, normalizeEmail } from '../../auth';
import { Bus, Route, RouteAssignment, Trip, User } from '../../database/models';
import {
  STAFF_BUSES_REPOSITORY,
  STAFF_EMAIL_TAKEN_MESSAGE,
  STAFF_REPOSITORY,
  STAFF_ROUTE_ASSIGNMENTS_REPOSITORY,
  STAFF_ROUTES_REPOSITORY,
  STAFF_TRIPS_REPOSITORY,
  staffDeletedMessage,
  staffNotFoundMessage,
} from './staff.constants';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

/** Ranked preference for the crew member's "current" trip today. */
const TRIP_PREFERENCE: Record<TripStatus, number> = {
  [TripStatus.IN_PROGRESS]: 0,
  [TripStatus.BOARDING]: 1,
  [TripStatus.SCHEDULED]: 2,
  [TripStatus.COMPLETED]: 3,
  [TripStatus.CANCELLED]: 4,
};

/** Paginated staff payload; `items` carries the caller's concrete staff role. */
export type StaffListResponseOf<R extends StaffRole> = StaffListResponse<StaffResponse<R>>;

/**
 * Tenant-safe management of users whose fixed role is `DRIVER` or
 * `CONDUCTOR`.
 *
 * One service instance conceptually manages one staff role: the controller
 * for `/drivers` always passes `UserRole.DRIVER` and the controller for
 * `/conductors` always passes `UserRole.CONDUCTOR`. The role is therefore a
 * server-owned constant per route — it is never read from a client body — and
 * every read and write is pinned to the `school_id` extracted from the
 * verified JWT claims. There is no client-controlled tenant or role field in
 * any staff DTO.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(STAFF_REPOSITORY) private readonly users: typeof User,
    @Inject(STAFF_ROUTE_ASSIGNMENTS_REPOSITORY)
    private readonly assignments: typeof RouteAssignment,
    @Inject(STAFF_ROUTES_REPOSITORY) private readonly routes: typeof Route,
    @Inject(STAFF_BUSES_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(STAFF_TRIPS_REPOSITORY) private readonly trips: typeof Trip,
  ) {}

  /**
   * Creates a driver or conductor account that can use the existing
   * `/auth/login` flow. The role and school are server-owned, and the
   * password is persisted only as a bcrypt digest.
   */
  async create<R extends StaffRole>(
    schoolId: string,
    role: R,
    dto: CreateStaffDto,
  ): Promise<StaffResponse<R>> {
    const email = normalizeEmail(dto.email);
    // Email uniqueness is tenant-scoped across ALL user roles (the unique
    // index is (school_id, email)), so a staff email may not collide with a
    // school admin or parent either.
    const existing = await this.users.findOne({ where: { school_id: schoolId, email } });
    if (existing) {
      throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      const member = await this.users.create({
        school_id: schoolId,
        role,
        first_name: dto.first_name.trim(),
        last_name: dto.last_name.trim(),
        email,
        password_hash: passwordHash,
        email_verified_at: null,
        phone: nullableTrim(dto.phone),
        is_active: dto.is_active ?? true,
      });
      return this.toStaffResponse(member, role);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /** Lists only staff users of the given role belonging to the JWT tenant. */
  async findAll<R extends StaffRole>(
    schoolId: string,
    role: R,
    query: ListStaffQueryDto,
  ): Promise<StaffListResponseOf<R>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      role,
    };
    const search = query.search?.trim();

    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { first_name: { [Op.iLike]: pattern } },
        { last_name: { [Op.iLike]: pattern } },
        { email: { [Op.iLike]: pattern } },
      ];
    }

    const { rows, count } = await this.users.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
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
      items: await this.toStaffResponses(rows, role),
      meta,
    };
  }

  /** Returns a staff account only when its id, tenant and role all match. */
  async findOne<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
  ): Promise<StaffResponse<R>> {
    return this.toStaffResponse(await this.findStaffOrThrow(schoolId, role, id), role);
  }

  /**
   * Updates a staff account without ever changing its tenant or role.
   * Supplying a new password hashes it with the same bcrypt utility used by
   * school onboarding and parent management.
   */
  async update<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffResponse<R>> {
    const member = await this.findStaffOrThrow(schoolId, role, id);
    const updates: Record<string, unknown> = {};

    if (dto.first_name !== undefined) updates.first_name = dto.first_name.trim();
    if (dto.last_name !== undefined) updates.last_name = dto.last_name.trim();
    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      // Again scoped across all roles: the (school_id, email) index is shared.
      const existing = await this.users.findOne({ where: { school_id: schoolId, email } });
      if (existing && existing.id !== id) {
        throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
      }
      updates.email = email;
    }
    if (dto.password !== undefined) {
      updates.password_hash = await hashPassword(dto.password);
    }
    if (dto.phone !== undefined) updates.phone = nullableTrim(dto.phone);
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    try {
      await member.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toStaffResponse(member, role);
  }

  /** Soft-deletes the account; historical assignment/trip rows stay auditable. */
  async remove<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
  ): Promise<StaffDeleteResponse> {
    const member = await this.findStaffOrThrow(schoolId, role, id);
    await member.destroy();
    return { id, message: staffDeletedMessage(role) };
  }

  private async findStaffOrThrow<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
  ): Promise<User> {
    const member = await this.users.findOne({
      where: { id, school_id: schoolId, role },
    });
    if (!member) {
      // The same response is used for an unknown id, another tenant and a
      // user of any other role (including the other staff role) so account
      // existence and role membership do not leak.
      throw new NotFoundException(staffNotFoundMessage(role));
    }
    return member;
  }

  /**
   * Explicit projection: password_hash and all ORM-only fields stay private.
   * The active roster's bus / route and today's trip status are resolved with
   * batched lookups so callers get names, never bare ids.
   */
  private async toStaffResponse<R extends StaffRole>(
    member: User,
    role: R,
  ): Promise<StaffResponse<R>> {
    const [response] = await this.toStaffResponses([member], role);
    return response as StaffResponse<R>;
  }

  /** Batched projection of staff members with their roster, route and trip. */
  private async toStaffResponses<R extends StaffRole>(
    members: User[],
    role: R,
  ): Promise<Array<StaffResponse<R>>> {
    if (members.length === 0) {
      return [];
    }
    const schoolId = members[0].school_id as string;
    const userIds = members.map((member) => member.id);

    const [assignments, todayTrips] = await Promise.all([
      this.assignments.findAll({
        where: { school_id: schoolId, user_id: { [Op.in]: userIds }, is_active: true },
        order: [['effective_from', 'ASC']],
      }),
      this.trips.findAll({
        where: {
          school_id: schoolId,
          [Op.or]: [
            { driver_id: { [Op.in]: userIds } },
            { conductor_id: { [Op.in]: userIds } },
          ],
          scheduled_start_at: todayRange(),
        },
        order: [['scheduled_start_at', 'ASC']],
      }),
    ]);

    const routeIds = [...new Set(assignments.map((assignment) => assignment.route_id))];
    const busIds = [...new Set(assignments.map((assignment) => assignment.bus_id).filter(isId))];
    const [routes, buses] = await Promise.all([
      routeIds.length
        ? this.routes.findAll({ where: { school_id: schoolId, id: { [Op.in]: routeIds } } })
        : Promise.resolve([] as Route[]),
      busIds.length
        ? this.buses.findAll({ where: { school_id: schoolId, id: { [Op.in]: busIds } } })
        : Promise.resolve([] as Bus[]),
    ]);

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const busById = new Map(buses.map((bus) => [bus.id, bus]));

    const assignmentByUser = new Map<string, RouteAssignment>();
    for (const assignment of assignments) {
      if (!assignmentByUser.has(assignment.user_id)) {
        assignmentByUser.set(assignment.user_id, assignment);
      }
    }
    const tripByUser = new Map<string, Trip>();
    for (const trip of todayTrips) {
      const userId = trip.driver_id ?? trip.conductor_id;
      if (!userId) continue;
      const current = tripByUser.get(userId);
      const better =
        !current ||
        TRIP_PREFERENCE[trip.status] < TRIP_PREFERENCE[current.status] ||
        (TRIP_PREFERENCE[trip.status] === TRIP_PREFERENCE[current.status] &&
          trip.scheduled_start_at.getTime() < current.scheduled_start_at.getTime());
      if (better) {
        tripByUser.set(userId, trip);
      }
    }

    return members.map((member) => {
      const assignment = assignmentByUser.get(member.id);
      const route = assignment ? routeById.get(assignment.route_id) : undefined;
      const bus = assignment?.bus_id ? busById.get(assignment.bus_id) : undefined;
      return {
        id: member.id,
        school_id: member.school_id as string,
        role,
        first_name: member.first_name,
        last_name: member.last_name,
        email: member.email as string,
        phone: member.phone,
        is_active: member.is_active,
        created_at: member.created_at.toISOString(),
        updated_at: member.updated_at.toISOString(),
        assigned_bus_number: bus?.bus_number ?? null,
        assigned_bus_registration: bus?.registration_number ?? null,
        assigned_route_name: route?.name ?? null,
        assigned_route_code: route?.code ?? null,
        current_trip_status: tripByUser.get(member.id)?.status ?? null,
      } as StaffResponse<R>;
    });
  }
}

/** Inclusive window covering the current UTC calendar day. */
function todayRange(): Record<symbol, Date> {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 86_400_000) };
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Escapes LIKE wildcards so a name/email search is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Re-exported for controllers/tests that want the role enumeration explicitly.
export { UserRole };
