import { Op, type WhereOptions } from 'sequelize';
import {
  AdminSubscriptionListItem,
  AdminSubscriptionListResponse,
  AdminSubscriptionUsage,
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  SubscriptionStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  Plan as PlanModel,
  Route,
  School,
  SchoolSubscription,
  Stop,
  Student,
  Trip,
  User,
} from '../../database/models';
import {
  ADMIN_BUSES_REPOSITORY,
  ADMIN_PLANS_REPOSITORY,
  ADMIN_ROUTES_REPOSITORY,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_STOPS_REPOSITORY,
  ADMIN_STUDENTS_REPOSITORY,
  ADMIN_SUBSCRIPTIONS_REPOSITORY,
  ADMIN_TRIPS_REPOSITORY,
  ADMIN_USERS_REPOSITORY,
} from './admin.constants';
import { toAdminSchoolSubscriptionPlanRef } from './admin-plans.mapper';
import type { ListAdminSubscriptionsQueryDto } from './dto';

/** Row shape returned by the aggregate/raw reads used for usage counts. */
interface RawRow {
  school_id: string;
  role?: UserRole;
  [key: string]: unknown;
}

interface ChosenSubscription {
  row: SchoolSubscription;
  is_current: boolean;
}

/**
 * Platform-wide subscription read model for Super Admins
 * (`GET /api/v1/admin/subscriptions`).
 *
 * Every school is listed once, paired with its current/latest subscription
 * (live first, otherwise the most recent record) or a clean `none` state.
 * The school relationship always comes from the data model — the endpoint
 * never accepts a client-supplied tenant id. Usage counts are plain aggregate
 * reads; no payment, invoice or billing data is involved.
 */
export class AdminGlobalSubscriptionsService {
  constructor(
    private readonly subscriptions: typeof SchoolSubscription,
    private readonly schools: typeof School,
    private readonly plans: typeof PlanModel,
    private readonly users: typeof User,
    private readonly students: typeof Student,
    private readonly buses: typeof Bus,
    private readonly routes: typeof Route,
    private readonly stops: typeof Stop,
    private readonly trips: typeof Trip,
  ) {}

  async findAll(query: ListAdminSubscriptionsQueryDto): Promise<AdminSubscriptionListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const schoolWhere: Record<PropertyKey, unknown> = {};
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      schoolWhere[Op.or] = [
        { name: { [Op.iLike]: pattern } },
        { code: { [Op.iLike]: pattern } },
        { subdomain: { [Op.iLike]: pattern } },
        { city: { [Op.iLike]: pattern } },
      ];
    }

    const schools = (await this.schools.findAll({
      where: schoolWhere as WhereOptions,
      order: [['name', 'ASC']],
    })) as unknown as School[];
    if (schools.length === 0) {
      return { items: [], meta: paginationMeta(page, limit, 0) };
    }

    const schoolIds = schools.map((school) => school.id);
    const subscriptionRows = (await this.subscriptions.findAll({
      where: { school_id: { [Op.in]: schoolIds } as never },
      order: [['created_at', 'DESC']],
    })) as unknown as SchoolSubscription[];

    const chosenBySchool = this.chooseCurrentBySchool(subscriptionRows);
    const selected = this.applyFilters(schools, chosenBySchool, query);

    const total = selected.length;
    const offset = (page - 1) * limit;
    const pageRows = selected.slice(offset, offset + limit);

    const planIds = [...new Set(pageRows.map((item) => item.plan_id).filter(Boolean))];
    const plans =
      planIds.length > 0
        ? ((await this.plans.findAll({
            where: { id: { [Op.in]: planIds } as never },
          })) as unknown as PlanModel[])
        : [];
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const usage = pageRows.length > 0 ? await this.collectUsage(pageRows.map((item) => item.school_id)) : new Map();

    const items: AdminSubscriptionListItem[] = pageRows.map((item) => {
      const plan = item.plan_id ? planById.get(item.plan_id) ?? null : null;
      return {
        subscription_id: item.subscriptionId,
        school_id: item.school_id,
        school_name: item.school_name,
        school_code: item.school_code,
        school_city: item.school_city,
        school_is_active: item.school_is_active,
        status: item.status,
        plan_id: item.plan_id,
        plan: plan ? toAdminSchoolSubscriptionPlanRef(plan) : null,
        current_period_start: toIso(item.row?.current_period_start),
        current_period_end: toIso(item.row?.current_period_end),
        trial_start: toIso(item.row?.trial_start),
        trial_end: toIso(item.row?.trial_end),
        cancelled_at: toIso(item.row?.cancelled_at),
        created_at: toIso(item.row?.created_at),
        updated_at: toIso(item.row?.updated_at),
        is_current: item.is_current,
        usage: usage.get(item.school_id) ?? emptyUsage(),
        limits: plan ? { ...plan.limits } : {},
      };
    });

    return { items, meta: paginationMeta(page, limit, total) };
  }

  /** Live row for a school, else its newest historical row (or none). */
  private chooseCurrentBySchool(rows: SchoolSubscription[]): Map<string, ChosenSubscription> {
    const chosen = new Map<string, ChosenSubscription>();
    for (const row of rows) {
      const schoolId = row.school_id;
      const existing = chosen.get(schoolId);
      if (!existing) {
        chosen.set(schoolId, { row, is_current: isLive(row.status) });
        continue;
      }
      if (!existing.is_current && isLive(row.status)) {
        chosen.set(schoolId, { row, is_current: true });
      }
    }
    return chosen;
  }
  private applyFilters(
    schools: School[],
    chosenBySchool: Map<string, ChosenSubscription>,
    query: ListAdminSubscriptionsQueryDto,
  ): SelectedSubscription[] {
    const selected: SelectedSubscription[] = [];
    for (const school of schools) {
      const chosen = chosenBySchool.get(school.id) ?? null;
      const status = chosen ? chosen.row.status : SubscriptionStatus.NONE;

      if (query.status && status !== query.status) continue;
      if (query.plan_id && (!chosen || chosen.row.plan_id !== query.plan_id)) continue;

      selected.push({
        subscriptionId: chosen ? chosen.row.id : null,
        school_id: school.id,
        school_name: school.name,
        school_code: school.code,
        school_city: school.city,
        school_is_active: school.is_active,
        status,
        plan_id: chosen ? chosen.row.plan_id : null,
        row: chosen?.row ?? null,
        is_current: Boolean(chosen?.is_current),
      });
    }
    return selected;
  }
  private async collectUsage(schoolIds: string[]): Promise<Map<string, AdminSubscriptionUsage>> {
    const [users, students, buses, routes, stops, trips] = await Promise.all([
      this.users.findAll({
        attributes: ['school_id', 'role'],
        where: { school_id: { [Op.in]: schoolIds } as never },
        raw: true,
      }) as unknown as Promise<RawRow[]>,
      this.students.findAll({
        attributes: ['school_id'],
        where: { school_id: { [Op.in]: schoolIds } as never },
        raw: true,
      }) as unknown as Promise<RawRow[]>,
      this.buses.findAll({
        attributes: ['school_id'],
        where: { school_id: { [Op.in]: schoolIds } as never },
        raw: true,
      }) as unknown as Promise<RawRow[]>,
      this.routes.findAll({
        attributes: ['school_id'],
        where: { school_id: { [Op.in]: schoolIds } as never },
        raw: true,
      }) as unknown as Promise<RawRow[]>,
      this.stops.findAll({
        attributes: ['school_id'],
        where: { school_id: { [Op.in]: schoolIds } as never },
        raw: true,
      }) as unknown as Promise<RawRow[]>,
      this.trips.findAll({
        attributes: ['school_id'],
        where: { school_id: { [Op.in]: schoolIds } as never },
        raw: true,
      }) as unknown as Promise<RawRow[]>,
    ]);

    const result = new Map<string, AdminSubscriptionUsage>();
    for (const schoolId of schoolIds) {
      result.set(schoolId, emptyUsage());
    }
    const bucket = (schoolId: string, patch: Partial<AdminSubscriptionUsage>) => {
      const current = result.get(schoolId);
      if (!current) return;
      Object.assign(current, patch);
    };

    const driverCounts = new Map<string, number>();
    const conductorCounts = new Map<string, number>();
    for (const row of users) {
      const schoolId = String(row.school_id);
      if (row.role === UserRole.DRIVER) {
        driverCounts.set(schoolId, (driverCounts.get(schoolId) ?? 0) + 1);
      } else if (row.role === UserRole.CONDUCTOR) {
        conductorCounts.set(schoolId, (conductorCounts.get(schoolId) ?? 0) + 1);
      } else if (row.role === UserRole.PARENT) {
        bucket(schoolId, { parents: (result.get(schoolId)?.parents ?? 0) + 1 });
      }
    }
    for (const [schoolId, count] of driverCounts) bucket(schoolId, { drivers: count });
    for (const [schoolId, count] of conductorCounts) bucket(schoolId, { conductors: count });
    for (const schoolId of new Set([...driverCounts.keys(), ...conductorCounts.keys()])) {
      bucket(schoolId, { staff: (driverCounts.get(schoolId) ?? 0) + (conductorCounts.get(schoolId) ?? 0) });
    }
    bucketCount(result, students, 'students');
    bucketCount(result, buses, 'buses');
    bucketCount(result, routes, 'routes');
    bucketCount(result, stops, 'stops');
    bucketCount(result, trips, 'trips');

    return result;
  }
}

interface SelectedSubscription {
  subscriptionId: string | null;
  school_id: string;
  school_name: string;
  school_code: string;
  school_city: string | null;
  school_is_active: boolean;
  status: SubscriptionStatus;
  plan_id: string | null;
  row: SchoolSubscription | null;
  is_current: boolean;
}

function emptyUsage(): AdminSubscriptionUsage {
  return {
    students: 0,
    buses: 0,
    routes: 0,
    stops: 0,
    drivers: 0,
    conductors: 0,
    staff: 0,
    parents: 0,
    trips: 0,
  };
}

/** Increments a numeric bucket from one row per resource. */
function bucketCount(
  result: Map<string, AdminSubscriptionUsage>,
  rows: RawRow[],
  key: keyof Omit<AdminSubscriptionUsage, 'drivers' | 'conductors' | 'staff'>,
): void {
  for (const row of rows) {
    const schoolId = String(row.school_id);
    const current = result.get(schoolId);
    if (!current) continue;
    current[key] = (current[key] as number) + 1;
  }
}

function isLive(status: SubscriptionStatus): boolean {
  return (LIVE_SUBSCRIPTION_STATUS_VALUES as string[]).includes(status);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function paginationMeta(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
