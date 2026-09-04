import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError } from 'sequelize';
import {
  AdminSchoolSubscriptionCancelRequest,
  AdminSchoolSubscriptionCreateRequest,
  AdminSchoolSubscriptionHistoryItem,
  AdminSchoolSubscriptionHistoryResponse,
  AdminSchoolSubscriptionInfo,
  AdminSchoolSubscriptionResponse,
  AdminSchoolSubscriptionUpdateRequest,
  LIVE_SUBSCRIPTION_STATUS_VALUES,
  PersistedSubscriptionStatus,
  SubscriptionStatus,
} from '@school-bus-tracking/shared-types';
import {
  adminSchoolSubscriptionCancelSchema,
  adminSchoolSubscriptionCreateSchema,
  adminSchoolSubscriptionUpdateSchema,
} from '@school-bus-tracking/validation';
import { ZodError } from 'zod';
import { ConfigService } from '../../framework';
import { Plan, School, SchoolSubscription } from '../../database/models';
import {
  pastDueGraceMsFromDays,
  resolveSubscriptionEntitlement,
} from '../../common/subscriptions';
import { ADMIN_PLANS_REPOSITORY, PLAN_NOT_FOUND_MESSAGE } from './admin-plans.constants';
import { toAdminPlanResponse, toAdminSchoolSubscriptionPlanRef } from './admin-plans.mapper';
import { ADMIN_SCHOOLS_REPOSITORY, SCHOOL_NOT_FOUND_MESSAGE } from './admin.constants';
import {
  ADMIN_SUBSCRIPTIONS_REPOSITORY,
  NO_SUBSCRIPTION_INFO,
  SUBSCRIPTION_ALREADY_EXISTS_MESSAGE,
  SUBSCRIPTION_NOT_ACTIVE_MESSAGE,
  SUBSCRIPTION_NOT_CANCELLABLE_MESSAGE,
  SUBSCRIPTION_NOT_FOUND_MESSAGE,
  SUBSCRIPTION_PLAN_INACTIVE_MESSAGE,
} from './admin-subscriptions.constants';

/**
 * Platform-level school subscription management for the Super Admin console.
 *
 * ```text
 * School  →  SchoolSubscription  →  Plan
 * ```
 *
 * Scope of this phase (Task 42, step 1): assign / change / cancel a
 * subscription and read its state. **No payment, invoicing, renewal, dunning
 * or limit enforcement is implemented** — the model simply records which plan
 * a school is on and the lifecycle window around it.
 *
 * Business rules enforced here:
 *
 * 1. The school must exist (404 otherwise) — subscriptions are always owned
 *    by a real tenant, even though the Super Admin itself is tenant-less.
 * 2. The plan must exist (404) and be **active** (409). A retired plan stays
 *    referenced by historical subscriptions, but may not be newly assigned:
 *    deactivation exists precisely to stop new sales, and Task 41 documents
 *    it that way ("hidden from new subscription flows").
 * 3. A school may have at most one *live* subscription (`trialing`,
 *    `active`, `past_due`) at a time (409). The database backs this up with a
 *    partial unique index, so concurrent requests cannot both win.
 * 4. Dates must be logically ordered: `trial_end >= trial_start`,
 *    `current_period_end >= current_period_start`, and a cancellation may not
 *    predate the period it cancels.
 * 5. History is never destroyed: changing plans closes the current row
 *    (status `expired`) and inserts a new one; cancelling keeps the row with
 *    its `cancelled_at` timestamp. Nothing is deleted.
 * 6. A school with no subscription row is reported as `status: 'none'` — the
 *    exact behaviour of the previous `NO_SUBSCRIPTION` placeholder.
 */
export class AdminSubscriptionsService {
  constructor(
    private readonly subscriptions: typeof SchoolSubscription,
    private readonly schools: typeof School,
    private readonly plans: typeof Plan,
    private readonly configService?: ConfigService,
  ) {}

  /**
   * Grace granted to `past_due` after `current_period_end`, in milliseconds.
   * Single source of truth shared with `PlanLimitsService`.
   */
  private pastDueGraceMs(): number | undefined {
    return pastDueGraceMsFromDays(this.configService?.get<number>('subscription.pastDueGraceDays'));
  }

  /**
   * Read-repair for a stored-live row whose window has already elapsed.
   *
   * Access eligibility is *always* computed from the dates (see
   * `resolveSubscriptionEntitlement`), so a lapsed row never grants paid
   * access even if this repair has not run yet. What the repair adds is the
   * persisted lifecycle status: an `active` row whose `current_period_end`
   * has passed is written back as `expired` the first time anyone looks at
   * it. That keeps the console honest, frees the single "live" slot for a new
   * subscription, and needs no cron job. The write is best effort — if it
   * fails, the row is still treated as not live for this request.
   */
  private async expireIfLapsed(
    row: SchoolSubscription | null,
  ): Promise<SchoolSubscription | null> {
    if (!row) {
      return null;
    }
    const entitlement = resolveSubscriptionEntitlement(row, new Date(), {
      pastDueGraceMs: this.pastDueGraceMs(),
    });
    if (!entitlement.lapsed) {
      return row;
    }
    try {
      await row.update({ status: SubscriptionStatus.EXPIRED });
    } catch {
      // Best effort: a concurrent writer or a read-only replica must not turn
      // a read into a 500. The row is reported as not live either way.
    }
    return null;
  }

  /**
   * `GET /admin/schools/:schoolId/subscription`.
   *
   * Returns the live subscription when there is one, otherwise the most
   * recent historical record (so a cancelled/expired subscription and its
   * cancellation date stay visible), otherwise a clean `none` state — never
   * an error for a school that simply has no subscription yet.
   */
  async getSubscription(schoolId: string): Promise<AdminSchoolSubscriptionResponse> {
    await this.requireSchool(schoolId);
    const subscription = await this.findCurrentOrLatest(schoolId);
    if (!subscription) {
      return noneResponse(schoolId);
    }
    return this.toResponse(subscription);
  }

  /**
   * `POST /admin/schools/:schoolId/subscription` — assign an active plan to a
   * school that has no live subscription.
   */
  async createSubscription(
    schoolId: string,
    dto: AdminSchoolSubscriptionCreateRequest,
  ): Promise<AdminSchoolSubscriptionResponse> {
    await this.requireSchool(schoolId);
    const validated = this.validateCreate(dto);
    const plan = await this.requireAssignablePlan(validated.plan_id);

    const live = await this.findLive(schoolId);
    if (live) {
      throw new ConflictException(SUBSCRIPTION_ALREADY_EXISTS_MESSAGE);
    }

    const now = new Date();
    const trialStart = toDate(validated.trial_start);
    const trialEnd = toDate(validated.trial_end);
    const status: PersistedSubscriptionStatus =
      (validated.status as PersistedSubscriptionStatus | undefined) ??
      (trialEnd ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE);

    // A trial with only an end date starts now; a trialing subscription must
    // always know when the trial ends (also a database CHECK constraint).
    const effectiveTrialStart = trialEnd && !trialStart ? now : trialStart;
    if (status === SubscriptionStatus.TRIALING && !trialEnd) {
      throw badRequest('trial_end', 'trial_end is required for a trialing subscription');
    }

    const periodStart = toDate(validated.current_period_start) ?? effectiveTrialStart ?? now;
    const periodEnd = toDate(validated.current_period_end);
    assertDateOrder(
      effectiveTrialStart,
      trialEnd,
      'trial_end',
      'trial_end cannot be before trial_start',
    );
    assertDateOrder(
      periodStart,
      periodEnd,
      'current_period_end',
      'current_period_end cannot be before current_period_start',
    );

    try {
      const created = await this.subscriptions.create({
        school_id: schoolId,
        plan_id: plan.id,
        status,
        trial_start: effectiveTrialStart,
        trial_end: trialEnd,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        cancelled_at: null,
      });
      return this.toResponse(created, plan);
    } catch (error) {
      // The partial unique index is the race-condition backstop for rule 3.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(SUBSCRIPTION_ALREADY_EXISTS_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * `PATCH /admin/schools/:schoolId/subscription` — change the school's plan
   * and/or the lifecycle fields of its live subscription.
   *
   * Changing the plan **supersedes** the current subscription instead of
   * rewriting it: the existing row is closed (`expired`, period end pinned to
   * the switch instant) and a new row is inserted on the new plan, so the
   * commercial history of the school stays intact. Status/date-only changes
   * are applied in place on the live row.
   */
  async updateSubscription(
    schoolId: string,
    dto: AdminSchoolSubscriptionUpdateRequest,
  ): Promise<AdminSchoolSubscriptionResponse> {
    await this.requireSchool(schoolId);
    const validated = this.validateUpdate(dto);

    const current = await this.findLive(schoolId);
    if (!current) {
      const anyRecord = await this.findCurrentOrLatest(schoolId);
      throw anyRecord
        ? new ConflictException(SUBSCRIPTION_NOT_ACTIVE_MESSAGE)
        : new NotFoundException(SUBSCRIPTION_NOT_FOUND_MESSAGE);
    }

    if (validated.plan_id !== undefined && validated.plan_id !== current.plan_id) {
      return this.changePlan(current, validated);
    }

    return this.applyInPlaceUpdate(current, validated);
  }

  /**
   * `POST /admin/schools/:schoolId/subscription/cancel` — cancel the live
   * subscription. The row is preserved (never deleted) with its cancellation
   * timestamp; no payment or refund is processed.
   */
  async cancelSubscription(
    schoolId: string,
    dto: AdminSchoolSubscriptionCancelRequest = {},
  ): Promise<AdminSchoolSubscriptionResponse> {
    await this.requireSchool(schoolId);
    const validated = this.validateCancel(dto);

    const current = await this.findLive(schoolId);
    if (!current) {
      const anyRecord = await this.findCurrentOrLatest(schoolId);
      throw anyRecord
        ? new ConflictException(SUBSCRIPTION_NOT_CANCELLABLE_MESSAGE)
        : new NotFoundException(SUBSCRIPTION_NOT_FOUND_MESSAGE);
    }

    const cancelledAt = toDate(validated.cancelled_at) ?? new Date();
    if (
      current.current_period_start &&
      cancelledAt.getTime() < new Date(current.current_period_start).getTime()
    ) {
      throw badRequest(
        'cancelled_at',
        'cancelled_at cannot be before the start of the current period',
      );
    }

    await current.update({ status: SubscriptionStatus.CANCELLED, cancelled_at: cancelledAt });
    await reloadIfPossible(current);
    return this.toResponse(current);
  }

  /**
   * `GET /admin/schools/:schoolId/subscription/history` — every subscription
   * row the school has ever had, newest first (Task 42, step 2).
   *
   * The change/cancel flows preserve rows instead of deleting them; this is
   * the read model of that history. Exactly **two queries** regardless of how
   * many rows exist (subscriptions, then their plans in bulk) — no N+1 — and
   * plan terms are resolved through `plan_id` at read time, never duplicated.
   */
  async getSubscriptionHistory(schoolId: string): Promise<AdminSchoolSubscriptionHistoryResponse> {
    await this.requireSchool(schoolId);

    const rows = await this.subscriptions.findAll({
      where: { school_id: schoolId },
      order: [['created_at', 'DESC']],
    });
    if (rows.length === 0) {
      return { items: [] };
    }

    const planIds = [...new Set(rows.map((row) => row.plan_id))];
    const plans =
      planIds.length > 0 ? await this.plans.findAll({ where: { id: { [Op.in]: planIds } } }) : [];
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    const items: AdminSchoolSubscriptionHistoryItem[] = rows.map((row) => {
      const plan = planById.get(row.plan_id) ?? null;
      return {
        id: row.id,
        school_id: row.school_id,
        status: row.status,
        plan_id: row.plan_id,
        plan: plan ? toAdminSchoolSubscriptionPlanRef(plan) : null,
        trial_start: toIso(row.trial_start),
        trial_end: toIso(row.trial_end),
        current_period_start: toIso(row.current_period_start),
        current_period_end: toIso(row.current_period_end),
        cancelled_at: toIso(row.cancelled_at),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
        is_current: isLive(row.status),
      };
    });
    return { items };
  }

  /**
   * Compact subscription block for one school (used by the school details
   * endpoint). Falls back to the `none` projection — the behaviour the old
   * `NO_SUBSCRIPTION` placeholder provided.
   */
  async getSubscriptionInfo(schoolId: string): Promise<AdminSchoolSubscriptionInfo> {
    const subscription = await this.findCurrentOrLatest(schoolId);
    if (!subscription) {
      return { ...NO_SUBSCRIPTION_INFO };
    }
    const plan = await this.resolvePlan(subscription);
    return {
      status: subscription.status,
      plan: plan ? toAdminSchoolSubscriptionPlanRef(plan) : null,
      current_period_end: toIso(subscription.current_period_end),
    };
  }

  /**
   * Bulk variant for the school list: two queries in total (subscriptions,
   * then their plans) regardless of the page size — no N+1. Schools without a
   * subscription are absent from the map and fall back to `none`.
   */
  async getSubscriptionInfoForSchools(
    schoolIds: string[],
  ): Promise<Map<string, AdminSchoolSubscriptionInfo>> {
    const result = new Map<string, AdminSchoolSubscriptionInfo>();
    if (schoolIds.length === 0) {
      return result;
    }

    const rows = await this.subscriptions.findAll({
      where: { school_id: { [Op.in]: schoolIds } },
      order: [['created_at', 'DESC']],
    });

    // Prefer the live subscription of each school, else its newest record.
    const chosen = new Map<string, SchoolSubscription>();
    for (const row of rows) {
      const key = String(row.school_id);
      const existing = chosen.get(key);
      if (!existing) {
        chosen.set(key, row);
        continue;
      }
      if (!isLive(existing.status) && isLive(row.status)) {
        chosen.set(key, row);
      }
    }

    const planIds = [...new Set([...chosen.values()].map((row) => row.plan_id))];
    const plans =
      planIds.length > 0 ? await this.plans.findAll({ where: { id: { [Op.in]: planIds } } }) : [];
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    for (const [schoolId, row] of chosen) {
      const plan = planById.get(row.plan_id) ?? null;
      result.set(schoolId, {
        status: row.status,
        plan: plan ? toAdminSchoolSubscriptionPlanRef(plan) : null,
        current_period_end: toIso(row.current_period_end),
      });
    }
    return result;
  }

  // ---- internals --------------------------------------------------------

  /** Closes the current subscription and opens a new one on another plan. */
  private async changePlan(
    current: SchoolSubscription,
    validated: AdminSchoolSubscriptionUpdateRequest,
  ): Promise<AdminSchoolSubscriptionResponse> {
    const plan = await this.requireAssignablePlan(validated.plan_id as string);

    const now = new Date();
    const switchAt = toDate(validated.current_period_start) ?? now;
    const trialStart = toDate(validated.trial_start);
    const trialEnd = toDate(validated.trial_end);
    const status: PersistedSubscriptionStatus =
      (validated.status as PersistedSubscriptionStatus | undefined) ??
      (trialEnd ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE);
    if (status === SubscriptionStatus.TRIALING && !trialEnd) {
      throw badRequest('trial_end', 'trial_end is required for a trialing subscription');
    }
    const periodEnd = toDate(validated.current_period_end);
    assertDateOrder(trialStart, trialEnd, 'trial_end', 'trial_end cannot be before trial_start');
    assertDateOrder(
      switchAt,
      periodEnd,
      'current_period_end',
      'current_period_end cannot be before current_period_start',
    );
    if (switchAt.getTime() < new Date(current.current_period_start).getTime()) {
      throw badRequest(
        'current_period_start',
        'current_period_start cannot be before the start of the current period',
      );
    }

    const previousEnd = current.current_period_end;
    const closedEnd =
      previousEnd && new Date(previousEnd).getTime() < switchAt.getTime()
        ? new Date(previousEnd)
        : switchAt;

    const run = async (transaction?: unknown): Promise<SchoolSubscription> => {
      const options = transaction ? ({ transaction } as never) : undefined;
      // Close the outgoing subscription first: the live-subscription unique
      // index only tolerates one live row per school at any instant.
      await current.update(
        { status: SubscriptionStatus.EXPIRED, current_period_end: closedEnd },
        options,
      );
      return this.subscriptions.create(
        {
          school_id: current.school_id,
          plan_id: plan.id,
          status,
          trial_start: trialEnd && !trialStart ? switchAt : trialStart,
          trial_end: trialEnd,
          current_period_start: switchAt,
          current_period_end: periodEnd,
          cancelled_at: null,
        },
        options,
      );
    };

    const sequelize = (this.subscriptions as unknown as { sequelize?: { transaction?: unknown } })
      .sequelize;
    let created: SchoolSubscription;
    if (sequelize && typeof sequelize.transaction === 'function') {
      created = await (
        sequelize.transaction as (
          cb: (t: unknown) => Promise<SchoolSubscription>,
        ) => Promise<SchoolSubscription>
      )((transaction) => run(transaction));
    } else {
      created = await run();
    }

    return this.toResponse(created, plan);
  }

  /** Applies status/date changes to the live subscription in place. */
  private async applyInPlaceUpdate(
    current: SchoolSubscription,
    validated: AdminSchoolSubscriptionUpdateRequest,
  ): Promise<AdminSchoolSubscriptionResponse> {
    const updates: Record<string, unknown> = {};

    const status = (validated.status as PersistedSubscriptionStatus | undefined) ?? current.status;
    const trialStart =
      validated.trial_start !== undefined ? toDate(validated.trial_start) : current.trial_start;
    const trialEnd =
      validated.trial_end !== undefined ? toDate(validated.trial_end) : current.trial_end;
    const periodStart =
      validated.current_period_start !== undefined
        ? (toDate(validated.current_period_start) ?? current.current_period_start)
        : current.current_period_start;
    const periodEnd =
      validated.current_period_end !== undefined
        ? toDate(validated.current_period_end)
        : current.current_period_end;

    assertDateOrder(trialStart, trialEnd, 'trial_end', 'trial_end cannot be before trial_start');
    assertDateOrder(
      periodStart,
      periodEnd,
      'current_period_end',
      'current_period_end cannot be before current_period_start',
    );
    if (status === SubscriptionStatus.TRIALING && !trialEnd) {
      throw badRequest('trial_end', 'trial_end is required for a trialing subscription');
    }

    if (validated.status !== undefined) updates.status = status;
    if (validated.trial_start !== undefined) updates.trial_start = trialStart;
    if (validated.trial_end !== undefined) updates.trial_end = trialEnd;
    if (validated.current_period_start !== undefined) updates.current_period_start = periodStart;
    if (validated.current_period_end !== undefined) updates.current_period_end = periodEnd;

    // A subscription moved straight to `cancelled` still needs its
    // cancellation timestamp (database CHECK constraint) — default to now.
    if (status === SubscriptionStatus.CANCELLED && !current.cancelled_at) {
      updates.cancelled_at = new Date();
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No valid subscription fields provided');
    }

    await current.update(updates);
    await reloadIfPossible(current);
    return this.toResponse(current);
  }
  private async requireSchool(schoolId: string): Promise<School> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(SCHOOL_NOT_FOUND_MESSAGE);
    }
    return school;
  }

  /** The plan must exist and still be on sale to be attached to a school. */
  private async requireAssignablePlan(planId: string): Promise<Plan> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(PLAN_NOT_FOUND_MESSAGE);
    }
    if (!plan.is_active) {
      throw new ConflictException(SUBSCRIPTION_PLAN_INACTIVE_MESSAGE);
    }
    return plan;
  }

  /** The school's current (live) subscription, if any. */
  private async findLive(schoolId: string): Promise<SchoolSubscription | null> {
    const row = await this.subscriptions.findOne({
      where: {
        school_id: schoolId,
        status: { [Op.in]: LIVE_SUBSCRIPTION_STATUS_VALUES },
      },
      order: [['created_at', 'DESC']],
    });
    return this.expireIfLapsed(row);
  }

  /** The live subscription, or the newest historical one. */
  private async findCurrentOrLatest(schoolId: string): Promise<SchoolSubscription | null> {
    const live = await this.findLive(schoolId);
    if (live) {
      return live;
    }
    return this.subscriptions.findOne({
      where: { school_id: schoolId },
      order: [['created_at', 'DESC']],
    });
  }

  /**
   * Plan of a subscription — from the eager-loaded association when present,
   * otherwise a single lookup. Plan data is never stored on the subscription.
   */
  private async resolvePlan(subscription: SchoolSubscription): Promise<Plan | null> {
    if (subscription.plan) {
      return subscription.plan;
    }
    return this.plans.findOne({ where: { id: subscription.plan_id } });
  }

  /** Full public projection of a subscription plus its plan. */
  private async toResponse(
    subscription: SchoolSubscription,
    knownPlan?: Plan,
  ): Promise<AdminSchoolSubscriptionResponse> {
    const plan = knownPlan ?? (await this.resolvePlan(subscription));
    const planResponse = plan ? toAdminPlanResponse(plan) : null;
    return {
      id: subscription.id,
      school_id: subscription.school_id,
      status: subscription.status,
      plan_id: subscription.plan_id,
      plan: planResponse,
      price: planResponse ? planResponse.price : null,
      currency: planResponse ? planResponse.currency : null,
      billing_period: planResponse ? planResponse.billing_period : null,
      trial_start: toIso(subscription.trial_start),
      trial_end: toIso(subscription.trial_end),
      current_period_start: toIso(subscription.current_period_start),
      current_period_end: toIso(subscription.current_period_end),
      cancelled_at: toIso(subscription.cancelled_at),
      created_at: toIso(subscription.created_at),
      updated_at: toIso(subscription.updated_at),
    };
  }
  private validateCreate(dto: AdminSchoolSubscriptionCreateRequest) {
    const result = adminSchoolSubscriptionCreateSchema.safeParse({ ...dto });
    if (!result.success) {
      throw validationException(result.error);
    }
    return result.data;
  }
  private validateUpdate(dto: AdminSchoolSubscriptionUpdateRequest) {
    const result = adminSchoolSubscriptionUpdateSchema.safeParse({ ...dto });
    if (!result.success) {
      throw validationException(result.error);
    }
    return result.data as AdminSchoolSubscriptionUpdateRequest;
  }
  private validateCancel(dto: AdminSchoolSubscriptionCancelRequest) {
    const result = adminSchoolSubscriptionCancelSchema.safeParse({ ...dto });
    if (!result.success) {
      throw validationException(result.error);
    }
    return result.data;
  }
}

/** The clean, non-error projection for a school without any subscription. */
function noneResponse(schoolId: string): AdminSchoolSubscriptionResponse {
  return {
    id: null,
    school_id: schoolId,
    status: SubscriptionStatus.NONE,
    plan_id: null,
    plan: null,
    price: null,
    currency: null,
    billing_period: null,
    trial_start: null,
    trial_end: null,
    current_period_start: null,
    current_period_end: null,
    cancelled_at: null,
    created_at: null,
    updated_at: null,
  };
}

function isLive(status: PersistedSubscriptionStatus): boolean {
  return LIVE_SUBSCRIPTION_STATUS_VALUES.includes(status);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest('date', 'Date must be a valid ISO-8601 date-time');
  }
  return date;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `end` may never precede `start` when both are present. */
function assertDateOrder(
  start: Date | null,
  end: Date | null,
  field: string,
  message: string,
): void {
  if (start && end && end.getTime() < start.getTime()) {
    throw badRequest(field, message);
  }
}

function badRequest(field: string, message: string): BadRequestException {
  return new BadRequestException({ message, details: { [field]: message } });
}

/** Reload after an update when the row supports it (real Sequelize models). */
async function reloadIfPossible(row: SchoolSubscription): Promise<void> {
  const reload = (row as unknown as { reload?: () => Promise<unknown> }).reload;
  if (typeof reload === 'function') {
    await reload.call(row);
  }
}

/** Converts a ZodError into a BadRequest with field-keyed `details`. */
function validationException(error: ZodError): BadRequestException {
  const details: Record<string, string> = {};
  const formMessages: string[] = [];
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      formMessages.push(issue.message);
      continue;
    }
    const key = issue.path.join('.');
    if (!details[key]) details[key] = issue.message;
  }
  return new BadRequestException({
    message: formMessages.length > 0 ? formMessages.join(' ') : 'Validation failed',
    details,
  });
}
