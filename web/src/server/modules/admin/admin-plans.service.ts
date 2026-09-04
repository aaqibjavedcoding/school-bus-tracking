import { BadRequestException, ConflictException, NotFoundException } from '../../framework';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  AdminPlanCreateRequest,
  AdminPlanLifecycleResponse,
  AdminPlanListResponse,
  AdminPlanResponse,
  AdminPlanSummary,
  AdminPlanUpdateRequest,
  PaginationMeta,
  PlanFeature,
  PlanFeaturesConfig,
  PlanLimitResource,
  PlanLimitsConfig,
  PlanLimitValue,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURE_VALUES,
  PLAN_LIMIT_RESOURCE_LABELS,
  PLAN_LIMIT_RESOURCE_VALUES,
} from '@school-bus-tracking/shared-types';
import {
  adminPlanCreateSchema,
  adminPlanUpdateSchema,
} from '@school-bus-tracking/validation';
import { ZodError } from 'zod';
import { Plan } from '../../database/models';
import { toAdminPlanResponse } from './admin-plans.mapper';
import {
  ADMIN_PLANS_REPOSITORY,
  CENTS_PER_UNIT,
  PLAN_ACTIVATED_MESSAGE,
  PLAN_CODE_TAKEN_MESSAGE,
  PLAN_DEACTIVATED_MESSAGE,
  PLAN_NOT_FOUND_MESSAGE,
} from './admin-plans.constants';
import { ListAdminPlansQueryDto } from './dto';

/** Number of enabled features shown in the list-view summary chip line. */
const SUMMARY_FEATURE_COUNT = 8;
/** Number of key limits shown in the list-view summary chip line. */
const SUMMARY_LIMIT_COUNT = 8;
/** Key resource limits surfaced first on the list view (ordered). */
const SUMMARY_LIMIT_ORDER: PlanLimitResource[] = [
  PlanLimitResource.STUDENTS,
  PlanLimitResource.BUSES,
  PlanLimitResource.ROUTES,
  PlanLimitResource.DRIVERS,
];

/**
 * Platform-level plan catalog management for the Super Admin console.
 *
 * Every method is platform-scoped (plans are tenant-less). The controller
 * layer already guarantees a `SUPER_ADMIN` identity. All monetary values are
 * accepted as decimal currency units (e.g. dollars) and converted to integer
 * cents for storage; the public projection converts them back to a numeric
 * value so clients never see the cents column.
 */
export class AdminPlansService {
  constructor(
    private readonly plans: typeof Plan,
  ) {}

  /** Creates a new plan after deep validation of features/limits. */
  async create(dto: AdminPlanCreateRequest): Promise<AdminPlanResponse> {
    const validated = this.validateCreate(dto);

    const features = sanitizeFeatures(validated.features);
    const limits = sanitizeLimits(validated.limits);

    try {
      const plan = await this.plans.create({
        code: validated.code,
        name: validated.name.trim(),
        description: validated.description?.trim() ?? null,
        price_cents: Math.round(validated.price * CENTS_PER_UNIT),
        currency: validated.currency.toUpperCase(),
        billing_period: validated.billing_period,
        is_active: validated.is_active ?? true,
        features,
        limits,
      });
      return this.toResponse(plan);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(PLAN_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /** Paginated, searchable plan catalog with feature/limit summaries. */
  async findAll(query: ListAdminPlansQueryDto): Promise<AdminPlanListResponse> {
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
        { description: { [Op.iLike]: pattern } },
      ];
    }

    const sortColumn = query.sort ?? 'created_at';
    const orderDirection =
      query.order?.toUpperCase() ?? (sortColumn === 'created_at' ? 'DESC' : 'ASC');

    // When sorting by price, order by the underlying cents column.
    const dbSortColumn = sortColumn === 'price' ? 'price_cents' : sortColumn;

    const { rows, count } = await this.plans.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [[dbSortColumn, orderDirection]],
    });

    const items: AdminPlanSummary[] = rows.map((plan) => this.toSummary(plan));

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

  /** A single plan by id; throws 404 if missing. */
  async findOneOrThrow(planId: string): Promise<AdminPlanResponse> {
    const plan = await this.requirePlan(planId);
    return this.toResponse(plan);
  }

  /** Updates allowed plan fields. `code` is immutable. */
  async update(planId: string, dto: AdminPlanUpdateRequest): Promise<AdminPlanResponse> {
    const plan = await this.requirePlan(planId);
    const validated = this.validateUpdate(dto);

    const updates: Record<string, unknown> = {};
    if (validated.name !== undefined) updates.name = validated.name.trim();
    if (validated.description !== undefined) {
      updates.description = validated.description ? validated.description.trim() : null;
    }
    if (validated.price !== undefined) {
      updates.price_cents = Math.round(validated.price * CENTS_PER_UNIT);
    }
    if (validated.currency !== undefined) updates.currency = validated.currency.toUpperCase();
    if (validated.billing_period !== undefined) updates.billing_period = validated.billing_period;
    if (validated.is_active !== undefined) updates.is_active = validated.is_active;
    if (validated.features !== undefined) updates.features = sanitizeFeatures(validated.features);
    if (validated.limits !== undefined) updates.limits = sanitizeLimits(validated.limits);

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No valid plan fields provided');
    }

    try {
      await plan.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(PLAN_CODE_TAKEN_MESSAGE);
      }
      throw error;
    }

    await plan.reload();
    return this.toResponse(plan);
  }

  /** Activates a plan so it can be attached to new subscriptions. */
  async activate(planId: string): Promise<AdminPlanLifecycleResponse> {
    const plan = await this.requirePlan(planId);
    if (!plan.is_active) {
      await plan.update({ is_active: true });
    }
    return {
      id: plan.id,
      status: 'active',
      is_active: true,
      message: PLAN_ACTIVATED_MESSAGE,
    };
  }

  /**
   * Deactivates a plan.
   *
   * This is a soft catalog change: existing subscriptions keep their reference
   * (no cascade, no data loss), but the plan is hidden from any new-sale
   * surface. The future subscriptions phase is responsible for enforcing
   * migration/renewal policies for schools on a deactivated plan.
   */
  async deactivate(planId: string): Promise<AdminPlanLifecycleResponse> {
    const plan = await this.requirePlan(planId);
    if (plan.is_active) {
      await plan.update({ is_active: false });
    }
    return {
      id: plan.id,
      status: 'inactive',
      is_active: false,
      message: PLAN_DEACTIVATED_MESSAGE,
    };
  }
  private async requirePlan(planId: string): Promise<Plan> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(PLAN_NOT_FOUND_MESSAGE);
    }
    return plan;
  }

  /** zod parse that surfaces a friendly BadRequest with field errors. */
  private validateCreate(dto: AdminPlanCreateRequest) {
    const result = adminPlanCreateSchema.safeParse(normalizePlanInput({ ...dto }));
    if (!result.success) {
      throw validationException(result.error);
    }
    return result.data;
  }
  private validateUpdate(dto: AdminPlanUpdateRequest) {
    const result = adminPlanUpdateSchema.safeParse(normalizePlanInput({ ...dto }));
    if (!result.success) {
      throw validationException(result.error);
    }
    return result.data;
  }

  /** Public full projection — no internal ORM state. */
  private toResponse(plan: Plan): AdminPlanResponse {
    // Shared with the school-subscription endpoints so plan data has exactly
    // one projection across the platform (never copied into subscriptions).
    return toAdminPlanResponse(plan);
  }

  /** Public list projection — includes a short feature/limit summary. */
  private toSummary(plan: Plan): AdminPlanSummary {
    const base = this.toResponse(plan);
    const enabledFeatures = PLAN_FEATURE_VALUES.filter((key) => base.features[key] === true);
    const feature_summary = enabledFeatures
      .slice(0, SUMMARY_FEATURE_COUNT)
      .map((key) => PLAN_FEATURE_LABELS[key]);

    const orderedLimits = SUMMARY_LIMIT_ORDER.filter((key) => base.limits[key] !== undefined);
    const remaining = PLAN_LIMIT_RESOURCE_VALUES.filter(
      (key) => !orderedLimits.includes(key) && base.limits[key] !== undefined,
    );
    const limitKeys = [...orderedLimits, ...remaining].slice(0, SUMMARY_LIMIT_COUNT);
    const limit_summary = limitKeys.map((key) => ({
      resource: key,
      label: PLAN_LIMIT_RESOURCE_LABELS[key],
      display: formatLimit(base.limits[key]!),
    }));

    return { ...base, feature_summary, limit_summary };
  }
}

/**
 * Trims string fields and normalises empty string → null for description,
 * before handing off to zod. Keeps the controller DTO shape permissive while
 * guaranteeing service-level strictness.
 */
function normalizePlanInput<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  if (typeof out.name === 'string') out.name = out.name.trim();
  if (typeof out.code === 'string') out.code = out.code.trim().toLowerCase();
  if (typeof out.currency === 'string') out.currency = out.currency.trim().toUpperCase();
  if (typeof out.description === 'string') {
    const trimmed = out.description.trim();
    out.description = trimmed.length === 0 ? null : trimmed;
  } else if (out.description === '') {
    out.description = null;
  }
  return out as T;
}

/**
 * Validates and normalises a feature map:
 * - Rejects unknown keys (enforced by zod via PlanFeature enum check).
 * - Drops any undefined entries (partial PATCH merges).
 * - Returns a plain object (no class prototypes).
 */
function sanitizeFeatures(input: PlanFeaturesConfig | undefined): PlanFeaturesConfig {
  if (!input) return {};
  const out: PlanFeaturesConfig = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!PLAN_FEATURE_VALUES.includes(key as PlanFeature)) {
      throw new BadRequestException({
        message: 'Unknown plan feature key',
        details: { features: { [key]: 'Unknown feature' } },
      });
    }
    out[key as PlanFeature] = Boolean(value);
  }
  return out;
}

/**
 * Validates and normalises a limits map. Zod already enforces shape; we add
 * defence in depth by requiring each value to satisfy the unlimited/value
 * invariant and dropping undefined entries.
 */
function sanitizeLimits(input: PlanLimitsConfig | undefined): PlanLimitsConfig {
  if (!input) return {};
  const out: PlanLimitsConfig = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!PLAN_LIMIT_RESOURCE_VALUES.includes(key as PlanLimitResource)) {
      throw new BadRequestException({
        message: 'Unknown plan limit resource',
        details: { limits: { [key]: 'Unknown resource' } },
      });
    }
    if (!value || typeof value !== 'object') {
      throw new BadRequestException({
        message: 'Invalid plan limit entry',
        details: { limits: { [key]: 'Must be an object with unlimited/value' } },
      });
    }
    const entry: PlanLimitValue = {
      unlimited: Boolean(value.unlimited),
      value: value.unlimited ? null : value.value == null ? null : Number(value.value),
    };
    if (!entry.unlimited && (entry.value === null || !Number.isInteger(entry.value) || entry.value < 0)) {
      throw new BadRequestException({
        message: 'Plan limit value must be a non-negative integer when unlimited is false',
        details: { limits: { [key]: 'value is required and must be >= 0 when unlimited is false' } },
      });
    }
    out[key as PlanLimitResource] = entry;
  }
  return out;
}

function formatLimit(limit: PlanLimitValue): string {
  if (limit.unlimited) return 'Unlimited';
  return new Intl.NumberFormat().format(Number(limit.value));
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
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
