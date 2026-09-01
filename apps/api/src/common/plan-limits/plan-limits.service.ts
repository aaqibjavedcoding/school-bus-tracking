import { Inject, Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import {
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  PlanLimitResource,
  PlanLimitValue,
  PlanLimitsConfig,
  StaffRole,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  Plan,
  Route,
  SchoolSubscription,
  Stop,
  Student,
  Trip,
  User,
} from '../../database/models';
import { PlanLimitReachedException } from './plan-limit-reached.exception';
import {
  PLAN_LIMITS_BUSES_REPOSITORY,
  PLAN_LIMITS_PLANS_REPOSITORY,
  PLAN_LIMITS_ROUTES_REPOSITORY,
  PLAN_LIMITS_STOPS_REPOSITORY,
  PLAN_LIMITS_STUDENTS_REPOSITORY,
  PLAN_LIMITS_SUBSCRIPTIONS_REPOSITORY,
  PLAN_LIMITS_TRIPS_REPOSITORY,
  PLAN_LIMITS_USERS_REPOSITORY,
} from './plan-limits.constants';

/**
 * Runtime plan-limit enforcement.
 *
 * `school_id` is always the authenticated tenant (never a client body field).
 * Usage is counted from existing rows (no duplicated counters). Soft-deleted
 * and inactive records do not consume quota, so capacity recovers after
 * delete/deactivate.
 */
@Injectable()
export class PlanLimitsService {
  constructor(
    @Inject(PLAN_LIMITS_SUBSCRIPTIONS_REPOSITORY)
    private readonly subscriptions: typeof SchoolSubscription,
    @Inject(PLAN_LIMITS_PLANS_REPOSITORY)
    private readonly plans: typeof Plan,
    @Inject(PLAN_LIMITS_STUDENTS_REPOSITORY)
    private readonly students: typeof Student,
    @Inject(PLAN_LIMITS_BUSES_REPOSITORY)
    private readonly buses: typeof Bus,
    @Inject(PLAN_LIMITS_ROUTES_REPOSITORY)
    private readonly routes: typeof Route,
    @Inject(PLAN_LIMITS_STOPS_REPOSITORY)
    private readonly stops: typeof Stop,
    @Inject(PLAN_LIMITS_USERS_REPOSITORY)
    private readonly users: typeof User,
    @Inject(PLAN_LIMITS_TRIPS_REPOSITORY)
    private readonly trips: typeof Trip,
  ) {}

  /**
   * Rejects creation when the school's live plan has already reached the
   * configured cap for `resource`. Missing subscription, missing limit, or
   * `unlimited: true` all allow the create.
   */
  async assertWithinLimit(schoolId: string, resource: PlanLimitResource): Promise<void> {
    const plan = await this.resolveLivePlan(schoolId);
    if (!plan) {
      return;
    }
    const cap = resolveCap(plan.limits, resource);
    if (cap === null) {
      return;
    }
    const usage = await this.countUsage(schoolId, resource);
    if (usage >= cap) {
      throw new PlanLimitReachedException(resource, cap, usage);
    }
  }

  /**
   * Driver/conductor create: honour a role-specific cap when present, else
   * the combined `staff` cap.
   */
  async assertStaffWithinLimit(schoolId: string, role: StaffRole): Promise<void> {
    const specific =
      role === UserRole.DRIVER ? PlanLimitResource.DRIVERS : PlanLimitResource.CONDUCTORS;
    const plan = await this.resolveLivePlan(schoolId);
    if (!plan) {
      return;
    }
    const specificCap = resolveCap(plan.limits, specific);
    if (specificCap !== null) {
      const usage = await this.countUsage(schoolId, specific);
      if (usage >= specificCap) {
        throw new PlanLimitReachedException(specific, specificCap, usage);
      }
    }
    const staffCap = resolveCap(plan.limits, PlanLimitResource.STAFF);
    if (staffCap !== null) {
      const usage = await this.countUsage(schoolId, PlanLimitResource.STAFF);
      if (usage >= staffCap) {
        throw new PlanLimitReachedException(PlanLimitResource.STAFF, staffCap, usage);
      }
    }
  }

  async countUsage(schoolId: string, resource: PlanLimitResource): Promise<number> {
    const school = { school_id: schoolId };
    switch (resource) {
      case PlanLimitResource.STUDENTS:
        return this.students.count({ where: { ...school, is_active: true } });
      case PlanLimitResource.BUSES:
        return this.buses.count({ where: { ...school, is_active: true } });
      case PlanLimitResource.ROUTES:
        return this.routes.count({ where: { ...school, is_active: true } });
      case PlanLimitResource.STOPS:
        return this.stops.count({ where: { ...school, is_active: true } });
      case PlanLimitResource.DRIVERS:
        return this.users.count({
          where: { ...school, role: UserRole.DRIVER, is_active: true },
        });
      case PlanLimitResource.CONDUCTORS:
        return this.users.count({
          where: { ...school, role: UserRole.CONDUCTOR, is_active: true },
        });
      case PlanLimitResource.STAFF:
        return this.users.count({
          where: {
            ...school,
            role: { [Op.in]: [UserRole.DRIVER, UserRole.CONDUCTOR] },
            is_active: true,
          },
        });
      case PlanLimitResource.PARENTS:
        return this.users.count({
          where: { ...school, role: UserRole.PARENT, is_active: true },
        });
      case PlanLimitResource.TRIPS:
        return this.trips.count({ where: school });
      default:
        return 0;
    }
  }

  /**
   * Live subscription (`trialing` / `active` / `past_due`) of this school
   * only, then the referenced Plan. Never reads another tenant's rows.
   */
  async resolveLivePlan(schoolId: string): Promise<Plan | null> {
    const subscription = await this.subscriptions.findOne({
      where: {
        school_id: schoolId,
        status: { [Op.in]: [...LIVE_SUBSCRIPTION_STATUS_VALUES] },
      },
    });
    if (!subscription) {
      return null;
    }
    const plan = await this.plans.findOne({ where: { id: subscription.plan_id } });
    return plan ?? null;
  }
}

/** Numeric cap, or `null` when the resource is unlimited / unconfigured. */
function resolveCap(limits: PlanLimitsConfig | undefined, resource: PlanLimitResource): number | null {
  const entry = limits?.[resource] as PlanLimitValue | undefined;
  if (!entry || entry.unlimited) {
    return null;
  }
  if (entry.value == null || !Number.isFinite(entry.value)) {
    return null;
  }
  return entry.value;
}
