import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  AdminSchoolAdminResponse,
  AdminSchoolDetailsResponse,
  AdminSchoolLifecycleResponse,
  AdminSchoolResponse,
  AdminSchoolStats,
  AdminSchoolStatus,
  AdminSchoolSubscriptionInfo,
  AdminSchoolSummary,
  AdminSchoolListResponse,
  AdminSchoolCreateRequest,
  AdminSchoolUpdateRequest,
  PaginationMeta,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { normalizeEmail } from '../../auth';
import { Bus, RefreshToken, Route, School, Student, Trip, User } from '../../database/models';
import { SchoolsService } from '../schools/schools.service';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { NO_SUBSCRIPTION_INFO } from './admin-subscriptions.constants';
import {
  ADMIN_BUSES_REPOSITORY,
  ADMIN_REFRESH_TOKENS_REPOSITORY,
  ADMIN_ROUTES_REPOSITORY,
  ADMIN_SCHOOL_CODE_TAKEN_MESSAGE,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_STUDENTS_REPOSITORY,
  ADMIN_TRIPS_REPOSITORY,
  ADMIN_USERS_REPOSITORY,
  SCHOOL_ACTIVATED_MESSAGE,
  SCHOOL_DEACTIVATED_MESSAGE,
  SCHOOL_NOT_FOUND_MESSAGE,
} from './admin.constants';
import { ListAdminSchoolsQueryDto } from './dto/list-admin-schools-query.dto';

/** Non-terminal trip states — the operational "active" trips of a tenant. */
const ACTIVE_TRIP_STATUSES = [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS];

/** Result of one grouped COUNT(*) query over `table`. */
type GroupCount = Record<string, number | string | boolean>;

/**
 * Platform-level school management for the Super Admin console.
 *
 * Every method is platform-scoped: the managed school id comes from the route
 * (the Super Admin is explicitly acting on another tenant), never from a JWT
 * claim, and the controller layer already guarantees a SUPER_ADMIN identity.
 * All statistics are computed with grouped aggregate queries — never with
 * per-school row loading (no N+1).
 */
@Injectable()
export class AdminSchoolsService {
  constructor(
    @Inject(ADMIN_SCHOOLS_REPOSITORY) private readonly schools: typeof School,
    @Inject(ADMIN_USERS_REPOSITORY) private readonly users: typeof User,
    @Inject(ADMIN_STUDENTS_REPOSITORY) private readonly students: typeof Student,
    @Inject(ADMIN_BUSES_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(ADMIN_ROUTES_REPOSITORY) private readonly routes: typeof Route,
    @Inject(ADMIN_TRIPS_REPOSITORY) private readonly trips: typeof Trip,
    @Inject(ADMIN_REFRESH_TOKENS_REPOSITORY)
    private readonly refreshTokens: typeof RefreshToken,
    private readonly onboarding: SchoolsService,
    /**
     * Subscription projections come from the subscription domain (Task 42).
     * Schools without a subscription still report the historical
     * `status: 'none'` block, so existing consumers are unaffected.
     */
    private readonly subscriptions: AdminSubscriptionsService,
  ) {}

  /**
   * Creates a new tenant school plus its initial SCHOOL_ADMIN by delegating to
   * the shared onboarding transaction, then returns the full platform
   * projection. No credentials are ever included.
   */
  async create(dto: AdminSchoolCreateRequest): Promise<AdminSchoolDetailsResponse> {
    const { school } = await this.onboarding.provisionSchool({
      name: dto.school.name,
      code: dto.school.code,
      subdomain: dto.school.subdomain,
      email: dto.school.email,
      phone: dto.school.phone,
      address_line1: dto.school.address_line1,
      address_line2: dto.school.address_line2,
      city: dto.school.city,
      state: dto.school.state,
      postal_code: dto.school.postal_code,
      country: dto.school.country,
      timezone: dto.school.timezone,
      admin: {
        first_name: dto.admin.first_name,
        last_name: dto.admin.last_name,
        email: dto.admin.email,
        password: dto.admin.password,
        phone: dto.admin.phone,
      },
    });

    return this.findOneOrThrow(school.id);
  }

  /** Paginated, searchable platform school list with per-tenant statistics. */
  async findAll(query: ListAdminSchoolsQueryDto): Promise<AdminSchoolListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = {};

    if (query.status) {
      where.is_active = query.status === 'active';
    }

    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: pattern } },
        { code: { [Op.iLike]: pattern } },
        { subdomain: { [Op.iLike]: pattern } },
        { email: { [Op.iLike]: pattern } },
        { city: { [Op.iLike]: pattern } },
      ];
    }

    const sortColumn = query.sort ?? 'created_at';
    const orderDirection =
      query.order?.toUpperCase() ?? (sortColumn === 'created_at' ? 'DESC' : 'ASC');

    const { rows, count } = await this.schools.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [[sortColumn, orderDirection]],
    });

    const schoolIds = rows.map((school) => school.id);
    const stats = schoolIds.length > 0 ? await this.collectSummaryStats(schoolIds) : new Map();
    const admins = schoolIds.length > 0 ? await this.collectPrimaryAdmins(schoolIds) : new Map();
    // Bulk subscription lookup: two queries for the whole page (no N+1).
    const subscriptions =
      schoolIds.length > 0
        ? await this.subscriptions.getSubscriptionInfoForSchools(schoolIds)
        : new Map<string, AdminSchoolSubscriptionInfo>();

    const items: AdminSchoolSummary[] = rows.map((school) => {
      const profile = this.toSchoolResponse(school);
      const rowStats = stats.get(school.id) ?? {
        admin_count: 0,
        student_count: 0,
        active_staff_count: 0,
        bus_count: 0,
      };
      return {
        ...profile,
        primary_admin: admins.get(school.id) ?? null,
        stats: rowStats,
        subscription: subscriptions.get(school.id) ?? { ...NO_SUBSCRIPTION_INFO },
      };
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

    return { items, meta };
  }

  /** Full platform overview for one tenant: profile, stats, admins. */
  async findOneOrThrow(schoolId: string): Promise<AdminSchoolDetailsResponse> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(SCHOOL_NOT_FOUND_MESSAGE);
    }

    const [stats, adminRows, subscription] = await Promise.all([
      this.collectSchoolStats(schoolId),
      this.users.findAll({
        where: { school_id: schoolId, role: UserRole.SCHOOL_ADMIN },
        order: [['created_at', 'ASC']],
      }),
      this.subscriptions.getSubscriptionInfo(schoolId),
    ]);

    return {
      school: this.toSchoolResponse(school),
      stats,
      admins: adminRows.map((admin) => this.toAdminResponse(admin)),
      subscription,
    };
  }

  /**
   * Updates legitimate school profile fields. The school id, code/tenant
   * identity, lifecycle flag and timestamps are never part of the validated
   * DTO, so they cannot be mutated through this endpoint.
   */
  async update(schoolId: string, dto: AdminSchoolUpdateRequest): Promise<AdminSchoolResponse> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(SCHOOL_NOT_FOUND_MESSAGE);
    }

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.email !== undefined) updates.email = dto.email ? normalizeEmail(dto.email) : null;
    if (dto.phone !== undefined) updates.phone = nullableTrim(dto.phone);
    if (dto.address_line1 !== undefined) updates.address_line1 = nullableTrim(dto.address_line1);
    if (dto.address_line2 !== undefined) updates.address_line2 = nullableTrim(dto.address_line2);
    if (dto.city !== undefined) updates.city = nullableTrim(dto.city);
    if (dto.state !== undefined) updates.state = nullableTrim(dto.state);
    if (dto.postal_code !== undefined) updates.postal_code = nullableTrim(dto.postal_code);
    if (dto.country !== undefined)
      updates.country = dto.country ? dto.country.trim().toUpperCase() : null;
    if (dto.timezone !== undefined) updates.timezone = dto.timezone.trim();

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No valid school profile fields provided');
    }

    if (updates.email !== undefined && updates.email !== null) {
      const existing = await this.schools.findOne({
        where: { email: updates.email },
      });
      if (existing && existing.id !== schoolId) {
        throw new ConflictException('A school with this contact email already exists');
      }
    }

    try {
      await school.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ADMIN_SCHOOL_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }

    await school.reload();
    return this.toSchoolResponse(school);
  }

  /** Re-activates a tenant; access is restored for all its users. */
  async activate(schoolId: string): Promise<AdminSchoolLifecycleResponse> {
    const school = await this.requireSchool(schoolId);
    if (!school.is_active) {
      await school.update({ is_active: true });
    }
    return {
      id: school.id,
      status: 'active',
      is_active: true,
      message: SCHOOL_ACTIVATED_MESSAGE,
    };
  }

  /**
   * Deactivates a tenant without deleting any data.
   *
   * The school row keeps `is_active = false`; every student, staff, bus,
   * route, trip, attendance and GPS history row stays untouched. All open
   * refresh-token sessions for the tenant are revoked in the same transaction
   * so deactivation takes effect immediately for already-issued credentials,
   * while new logins and existing access tokens are blocked centrally by the
   * inactive-school guard checks.
   */
  async deactivate(schoolId: string): Promise<AdminSchoolLifecycleResponse> {
    const school = await this.requireSchool(schoolId);
    if (school.is_active) {
      await school.sequelize!.transaction(async (transaction) => {
        await school.update({ is_active: false }, { transaction });
        await this.refreshTokens.update({ revoked_at: new Date() }, {
          where: { school_id: schoolId, revoked_at: null },
          transaction,
        } as never);
      });
    }
    return {
      id: school.id,
      status: 'inactive',
      is_active: false,
      message: SCHOOL_DEACTIVATED_MESSAGE,
    };
  }

  private async requireSchool(schoolId: string): Promise<School> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(SCHOOL_NOT_FOUND_MESSAGE);
    }
    return school;
  }

  /**
   * Per-school counts for the list page — four grouped aggregate queries
   * total, regardless of the number of schools (no N+1).
   */
  private async collectSummaryStats(
    schoolIds: string[],
  ): Promise<
    Map<
      string,
      { admin_count: number; student_count: number; active_staff_count: number; bus_count: number }
    >
  > {
    const [userRows, studentRows, busRows] = await Promise.all([
      this.users.findAll({
        attributes: [
          'school_id',
          'role',
          'is_active',
          [this.users.sequelize!.fn('COUNT', this.users.sequelize!.col('id')), 'count'],
        ],
        where: {
          school_id: { [Op.in]: schoolIds },
          role: { [Op.in]: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR] },
        },
        group: ['school_id', 'role', 'is_active'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
      this.students.findAll({
        attributes: [
          'school_id',
          [this.students.sequelize!.fn('COUNT', this.students.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: { [Op.in]: schoolIds } },
        group: ['school_id'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
      this.buses.findAll({
        attributes: [
          'school_id',
          [this.buses.sequelize!.fn('COUNT', this.buses.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: { [Op.in]: schoolIds } },
        group: ['school_id'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
    ]);

    const result = new Map<
      string,
      { admin_count: number; student_count: number; active_staff_count: number; bus_count: number }
    >();
    for (const id of schoolIds) {
      result.set(id, { admin_count: 0, student_count: 0, active_staff_count: 0, bus_count: 0 });
    }

    for (const row of userRows) {
      const bucket = result.get(String(row.school_id));
      if (!bucket) continue;
      const count = Number(row.count ?? 0);
      if (row.role === UserRole.SCHOOL_ADMIN) {
        bucket.admin_count += count;
      } else if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        bucket.active_staff_count += count;
      }
    }
    for (const row of studentRows) {
      result.get(String(row.school_id))!.student_count += Number(row.count ?? 0);
    }
    for (const row of busRows) {
      result.get(String(row.school_id))!.bus_count += Number(row.count ?? 0);
    }
    return result;
  }

  /**
   * Primary admin (earliest-created SCHOOL_ADMIN) per school in a single
   * query — the contact name shown in the school table.
   */
  private async collectPrimaryAdmins(
    schoolIds: string[],
  ): Promise<
    Map<string, { id: string; first_name: string; last_name: string; email: string | null }>
  > {
    const rows = await this.users.findAll({
      attributes: ['id', 'school_id', 'first_name', 'last_name', 'email'],
      where: { school_id: { [Op.in]: schoolIds }, role: UserRole.SCHOOL_ADMIN },
      order: [['created_at', 'ASC']],
      raw: true,
    });

    const result = new Map<
      string,
      { id: string; first_name: string; last_name: string; email: string | null }
    >();
    for (const row of rows) {
      const key = String(row.school_id);
      if (!result.has(key)) {
        result.set(key, {
          id: String(row.id),
          first_name: String(row.first_name),
          last_name: String(row.last_name),
          email: (row.email as string | null) ?? null,
        });
      }
    }
    return result;
  }

  /** Full tenant statistics for the details page — grouped aggregates only. */
  private async collectSchoolStats(schoolId: string): Promise<AdminSchoolStats> {
    const [userRows, studentRows, busRows, routeRows, tripRows] = await Promise.all([
      this.users.findAll({
        attributes: [
          'role',
          'is_active',
          [this.users.sequelize!.fn('COUNT', this.users.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: schoolId },
        group: ['role', 'is_active'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
      this.students.findAll({
        attributes: [
          'is_active',
          [this.students.sequelize!.fn('COUNT', this.students.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: schoolId },
        group: ['is_active'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
      this.buses.findAll({
        attributes: [
          'is_active',
          [this.buses.sequelize!.fn('COUNT', this.buses.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: schoolId },
        group: ['is_active'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
      this.routes.findAll({
        attributes: [
          'is_active',
          [this.routes.sequelize!.fn('COUNT', this.routes.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: schoolId },
        group: ['is_active'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
      this.trips.findAll({
        attributes: [
          'status',
          [this.trips.sequelize!.fn('COUNT', this.trips.sequelize!.col('id')), 'count'],
        ],
        where: { school_id: schoolId },
        group: ['status'],
        raw: true,
      }) as unknown as Promise<GroupCount[]>,
    ]);

    const stats: AdminSchoolStats = {
      admin_count: 0,
      active_admin_count: 0,
      student_count: 0,
      active_student_count: 0,
      driver_count: 0,
      conductor_count: 0,
      active_staff_count: 0,
      parent_count: 0,
      bus_count: 0,
      active_bus_count: 0,
      route_count: 0,
      active_route_count: 0,
      trip_count: 0,
      active_trip_count: 0,
    };

    const isActiveFlag = (value: unknown): boolean =>
      value === true || value === 1 || value === 'true';

    for (const row of userRows) {
      const count = Number(row.count ?? 0);
      const active = isActiveFlag(row.is_active);
      switch (row.role) {
        case UserRole.SCHOOL_ADMIN:
          stats.admin_count += count;
          if (active) stats.active_admin_count += count;
          break;
        case UserRole.DRIVER:
          stats.driver_count += count;
          if (active) stats.active_staff_count += count;
          break;
        case UserRole.CONDUCTOR:
          stats.conductor_count += count;
          if (active) stats.active_staff_count += count;
          break;
        case UserRole.PARENT:
          stats.parent_count += count;
          break;
      }
    }
    for (const row of studentRows) {
      stats.student_count += Number(row.count ?? 0);
      if (isActiveFlag(row.is_active)) stats.active_student_count += Number(row.count ?? 0);
    }
    for (const row of busRows) {
      stats.bus_count += Number(row.count ?? 0);
      if (isActiveFlag(row.is_active)) stats.active_bus_count += Number(row.count ?? 0);
    }
    for (const row of routeRows) {
      stats.route_count += Number(row.count ?? 0);
      if (isActiveFlag(row.is_active)) stats.active_route_count += Number(row.count ?? 0);
    }
    for (const row of tripRows) {
      const count = Number(row.count ?? 0);
      stats.trip_count += count;
      if (ACTIVE_TRIP_STATUSES.includes(row.status as TripStatus)) {
        stats.active_trip_count += count;
      }
    }

    return stats;
  }

  /** Strict profile projection — credentials are never present. */
  private toSchoolResponse(school: School): AdminSchoolResponse {
    return {
      id: school.id,
      name: school.name,
      code: school.code,
      subdomain: school.subdomain,
      email: school.email,
      phone: school.phone,
      address_line1: school.address_line1,
      address_line2: school.address_line2,
      city: school.city,
      state: school.state,
      postal_code: school.postal_code,
      country: school.country,
      timezone: school.timezone,
      status: (school.is_active ? 'active' : 'inactive') as AdminSchoolStatus,
      is_active: school.is_active,
      created_at: school.created_at.toISOString(),
      updated_at: school.updated_at.toISOString(),
    };
  }

  private toAdminResponse(user: User): AdminSchoolAdminResponse {
    return {
      id: user.id,
      school_id: user.school_id as string,
      role: UserRole.SCHOOL_ADMIN,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email as string,
      phone: user.phone,
      is_active: user.is_active,
      email_verified_at: user.email_verified_at ? user.email_verified_at.toISOString() : null,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString(),
    };
  }
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
