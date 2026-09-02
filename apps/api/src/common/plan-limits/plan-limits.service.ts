import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
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
import {
  SubscriptionLapsedException,
  pastDueGraceMsFromDays,
  resolveSubscriptionEntitlement,
} from '../subscriptions';
import { PlanLimitReachedException } from './plan-limit-reached.exception';
import {
  PLAN_LIMITS_BUSES_REPOSITORY,
  PLAN_LIMITS_PLANS_REPOSITORY,
  PLAN_LIMITS_ROUTES_REPOSITORY,
  PLAN_LIMITS_SEQUELIZE,
  PLAN_LIMITS_STOPS_REPOSITORY,
  PLAN_LIMITS_STUDENTS_REPOSITORY,
  PLAN_LIMITS_SUBSCRIPTIONS_REPOSITORY,
  PLAN_LIMITS_TRIPS_REPOSITORY,
  PLAN_LIMITS_USERS_REPOSITORY,
} from './plan-limits.constants';

/** Work executed under the plan-limit reservation, inside its transaction. */
export type PlanLimitedWork<T> = (transaction?: Transaction) => Promise<T>;

/**
 * Runtime plan-limit enforcement.
 *
 * `school_id` is always the authenticated tenant (never a client body field).
 * Usage is counted from existing rows (no duplicated counters). Soft-deleted
 * and inactive records do not consume quota, so capacity recovers after
 * delete/deactivate.
 *
 * ## Concurrency
 *
 * A naive `count()` then `create()` is a check-then-act race: with limit 100
 * and 99 rows, two simultaneous creates both read 99, both pass, and the
 * tenant ends up with 101. {@link runWithinLimit} closes that window by doing
 * the count *and* the create inside one transaction that holds a PostgreSQL
 * **transaction-scoped advisory lock** keyed by `school_id + resource`:
 *
 * - the lock is released automatically at COMMIT/ROLLBACK (no leaks, no
 *   in-memory mutex, works across API instances because the lock lives in the
 *   database);
 * - it is scoped per tenant *and* per resource, so two different schools — or
 *   buses and students of the same school — never queue behind each other;
 * - the second concurrent create re-counts after the first commits, sees 100
 *   and is rejected with the existing `PlanLimitReachedException`.
 *
 * ## Subscription window
 *
 * Plan resolution is time-aware (see `common/subscriptions`): a stored status
 * of `active`/`trialing` whose period/trial has ended no longer yields the
 * paid plan, and — when `SUBSCRIPTION_ENFORCE_LAPSED_ACCESS` is on (default) —
 * new plan-limited resources are refused with `SUBSCRIPTION_INACTIVE`.
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
    /**
     * Live Sequelize connection. Optional so the service stays trivially
     * unit-constructible with stub repositories (the existing unit tests build
     * it with eight arguments); without it the enforcement degrades to the
     * historical non-transactional check, which is only ever the case in
     * stubbed test bootstraps that have no database at all.
     */
    @Optional()
    @Inject(PLAN_LIMITS_SEQUELIZE)
    private readonly sequelize?: Sequelize | null,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /**
   * Runs `work` under a plan-limit reservation for `resource`.
   *
   * Everything happens inside one transaction guarded by an advisory lock, so
   * the count that authorised the create cannot go stale before the row is
   * written. Callers must use the transaction handed to `work` for their
   * INSERT — that is what makes the reservation atomic.
   */
  async runWithinLimit<T>(
    schoolId: string,
    resource: PlanLimitResource,
    work: PlanLimitedWork<T>,
  ): Promise<T> {
    if (!this.sequelize) {
      await this.assertWithinLimit(schoolId, resource);
      return work();
    }
    return this.sequelize.transaction(async (transaction) => {
      await this.acquireAdvisoryLock(schoolId, resource, transaction);
      await this.assertWithinLimit(schoolId, resource, transaction);
      return work(transaction);
    });
  }

  /** {@link runWithinLimit} for the driver/conductor (staff) caps. */
  async runWithinStaffLimit<T>(
    schoolId: string,
    role: StaffRole,
    work: PlanLimitedWork<T>,
  ): Promise<T> {
    if (!this.sequelize) {
      await this.assertStaffWithinLimit(schoolId, role);
      return work();
    }
    return this.sequelize.transaction(async (transaction) => {
      // A single lock for the whole staff family: the role-specific and the
      // combined caps must be evaluated against a stable snapshot.
      await this.acquireAdvisoryLock(schoolId, PlanLimitResource.STAFF, transaction);
      await this.assertStaffWithinLimit(schoolId, role, transaction);
      return work(transaction);
    });
  }

  /**
   * {@link runWithinLimit} for bulk writes that create `additional` records at
   * once (spreadsheet imports).
   *
   * The difference from the single-record path is that the check is
   * `usage + additional > cap` rather than `usage >= cap`: a school with 4 free
   * seats must not be able to slip a 500-row file through just because the
   * *first* row fits. Several resources can be reserved together (a driver
   * import meters both `drivers` and the combined `staff` cap), and the locks
   * are taken in a stable sorted order so two concurrent imports can never
   * deadlock against each other.
   */
  async runWithinBulkLimit<T>(
    schoolId: string,
    resources: PlanLimitResource[],
    additional: number,
    work: PlanLimitedWork<T>,
  ): Promise<T> {
    const unique = [...new Set(resources)].sort();

    if (!this.sequelize) {
      for (const resource of unique) {
        await this.assertBulkWithinLimit(schoolId, resource, additional);
      }
      return work();
    }

    return this.sequelize.transaction(async (transaction) => {
      for (const resource of unique) {
        await this.acquireAdvisoryLock(schoolId, resource, transaction);
      }
      for (const resource of unique) {
        await this.assertBulkWithinLimit(schoolId, resource, additional, transaction);
      }
      return work(transaction);
    });
  }

  /**
   * Rejects a bulk create that would take the school past its cap.
   *
   * `additional <= 0` short-circuits: an upsert-only import creates nothing and
   * must not be blocked by a plan that is already at its limit.
   */
  async assertBulkWithinLimit(
    schoolId: string,
    resource: PlanLimitResource,
    additional: number,
    transaction?: Transaction,
  ): Promise<void> {
    if (additional <= 0) {
      return;
    }
    const plan = await this.resolveLivePlan(schoolId, transaction);
    if (!plan) {
      return;
    }
    const cap = resolveCap(plan.limits, resource);
    if (cap === null) {
      return;
    }
    const usage = await this.countUsage(schoolId, resource, transaction);
    if (usage + additional > cap) {
      throw new PlanLimitReachedException(resource, cap, usage);
    }
  }

  /**
   * Rejects creation when the school's live plan has already reached the
   * configured cap for `resource`. Missing subscription, missing limit, or
   * `unlimited: true` all allow the create.
   */
  async assertWithinLimit(
    schoolId: string,
    resource: PlanLimitResource,
    transaction?: Transaction,
  ): Promise<void> {
    const plan = await this.resolveLivePlan(schoolId, transaction);
    if (!plan) {
      return;
    }
    const cap = resolveCap(plan.limits, resource);
    if (cap === null) {
      return;
    }
    const usage = await this.countUsage(schoolId, resource, transaction);
    if (usage >= cap) {
      throw new PlanLimitReachedException(resource, cap, usage);
    }
  }

  /**
   * Driver/conductor create: honour a role-specific cap when present, else
   * the combined `staff` cap.
   */
  async assertStaffWithinLimit(
    schoolId: string,
    role: StaffRole,
    transaction?: Transaction,
  ): Promise<void> {
    const specific =
      role === UserRole.DRIVER ? PlanLimitResource.DRIVERS : PlanLimitResource.CONDUCTORS;
    const plan = await this.resolveLivePlan(schoolId, transaction);
    if (!plan) {
      return;
    }
    const specificCap = resolveCap(plan.limits, specific);
    if (specificCap !== null) {
      const usage = await this.countUsage(schoolId, specific, transaction);
      if (usage >= specificCap) {
        throw new PlanLimitReachedException(specific, specificCap, usage);
      }
    }
    const staffCap = resolveCap(plan.limits, PlanLimitResource.STAFF);
    if (staffCap !== null) {
      const usage = await this.countUsage(schoolId, PlanLimitResource.STAFF, transaction);
      if (usage >= staffCap) {
        throw new PlanLimitReachedException(PlanLimitResource.STAFF, staffCap, usage);
      }
    }
  }

  async countUsage(
    schoolId: string,
    resource: PlanLimitResource,
    transaction?: Transaction,
  ): Promise<number> {
    const school = { school_id: schoolId };
    const options = transaction ? { transaction } : {};
    switch (resource) {
      case PlanLimitResource.STUDENTS:
        return this.students.count({ where: { ...school, is_active: true }, ...options });
      case PlanLimitResource.BUSES:
        return this.buses.count({ where: { ...school, is_active: true }, ...options });
      case PlanLimitResource.ROUTES:
        return this.routes.count({ where: { ...school, is_active: true }, ...options });
      case PlanLimitResource.STOPS:
        return this.stops.count({ where: { ...school, is_active: true }, ...options });
      case PlanLimitResource.DRIVERS:
        return this.users.count({
          where: { ...school, role: UserRole.DRIVER, is_active: true },
          ...options,
        });
      case PlanLimitResource.CONDUCTORS:
        return this.users.count({
          where: { ...school, role: UserRole.CONDUCTOR, is_active: true },
          ...options,
        });
      case PlanLimitResource.STAFF:
        return this.users.count({
          where: {
            ...school,
            role: { [Op.in]: [UserRole.DRIVER, UserRole.CONDUCTOR] },
            is_active: true,
          },
          ...options,
        });
      case PlanLimitResource.PARENTS:
        return this.users.count({
          where: { ...school, role: UserRole.PARENT, is_active: true },
          ...options,
        });
      case PlanLimitResource.TRIPS:
        return this.trips.count({ where: school, ...options });
      default:
        return 0;
    }
  }

  /**
   * Live subscription (`trialing` / `active` / `past_due`) of this school
   * only, then the referenced Plan. Never reads another tenant's rows.
   *
   * Time-aware: a live row whose trial/period has already ended does not
   * resolve to a plan. When lapsed-access enforcement is enabled (the
   * default) the lapse is reported as `SUBSCRIPTION_INACTIVE` instead of
   * silently degrading to "no subscription", because "no subscription" means
   * "no limits configured" in this codebase and would otherwise *reward*
   * expiry with unlimited capacity.
   */
  async resolveLivePlan(schoolId: string, transaction?: Transaction): Promise<Plan | null> {
    const subscription = await this.subscriptions.findOne({
      where: {
        school_id: schoolId,
        status: { [Op.in]: [...LIVE_SUBSCRIPTION_STATUS_VALUES] },
      },
      ...(transaction ? { transaction } : {}),
    });
    if (!subscription) {
      return null;
    }

    const entitlement = resolveSubscriptionEntitlement(subscription, new Date(), {
      pastDueGraceMs: pastDueGraceMsFromDays(
        this.configService?.get<number>('subscription.pastDueGraceDays'),
      ),
    });

    if (!entitlement.has_paid_access) {
      if (this.isLapsedAccessEnforced()) {
        throw new SubscriptionLapsedException(entitlement.effective_status, subscription.status);
      }
      return null;
    }

    const plan = await this.plans.findOne({
      where: { id: subscription.plan_id },
      ...(transaction ? { transaction } : {}),
    });
    return plan ?? null;
  }

  private isLapsedAccessEnforced(): boolean {
    return this.configService?.get<boolean>('subscription.enforceLapsedAccess') !== false;
  }

  /**
   * Transaction-scoped advisory lock keyed by `school_id + resource`.
   *
   * `hashtextextended` turns the composite key into the bigint the advisory
   * lock API expects. Lock scope is the transaction, so it is released on
   * COMMIT/ROLLBACK even if the create throws.
   */
  private async acquireAdvisoryLock(
    schoolId: string,
    resource: PlanLimitResource,
    transaction: Transaction,
  ): Promise<void> {
    if (!this.sequelize) {
      return;
    }
    await this.sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended($key, 0))', {
      bind: { key: `plan-limit:${schoolId}:${resource}` },
      type: QueryTypes.SELECT,
      transaction,
    });
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
