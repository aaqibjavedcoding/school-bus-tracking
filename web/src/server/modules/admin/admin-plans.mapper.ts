import {
  AdminPlanResponse,
  AdminPlanStatus,
  AdminSchoolSubscriptionPlanRef,
  PlanBillingPeriod,
  PlanLimitsConfig,
} from '@school-bus-tracking/shared-types';
import { Plan } from '../../database/models';
import { CENTS_PER_UNIT } from './admin-plans.constants';

/**
 * Single source of truth for projecting a `Plan` row onto the public API
 * shape.
 *
 * Both the plan catalog endpoints and the school subscription endpoints need
 * plan data, and subscriptions must never copy plan fields into their own
 * table — they resolve them through `plan_id`. Keeping the projection here
 * guarantees the two surfaces can never drift apart.
 */
export function toAdminPlanResponse(plan: Plan): AdminPlanResponse {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    price: (plan.price_cents / CENTS_PER_UNIT).toFixed(2),
    currency: plan.currency,
    billing_period: plan.billing_period as PlanBillingPeriod,
    is_active: plan.is_active,
    status: (plan.is_active ? 'active' : 'inactive') as AdminPlanStatus,
    features: { ...plan.features },
    limits: { ...plan.limits } as PlanLimitsConfig,
    created_at: plan.created_at.toISOString(),
    updated_at: plan.updated_at.toISOString(),
  };
}

/** Compact plan reference embedded in the school list/details subscription block. */
export function toAdminSchoolSubscriptionPlanRef(plan: Plan): AdminSchoolSubscriptionPlanRef {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    price: (plan.price_cents / CENTS_PER_UNIT).toFixed(2),
    currency: plan.currency,
    billing_period: plan.billing_period as PlanBillingPeriod,
    is_active: plan.is_active,
  };
}
