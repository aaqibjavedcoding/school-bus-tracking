import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import {
  AdminSchoolSubscriptionCancelRequest,
  AdminSchoolSubscriptionCreateRequest,
  AdminSchoolSubscriptionUpdateRequest,
  ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES,
  PERSISTED_SUBSCRIPTION_STATUS_VALUES,
  SubscriptionStatus,
} from '@school-bus-tracking/shared-types';

/**
 * Strict NestJS DTOs for Super Admin school subscription management.
 *
 * Validated by the global `ValidationPipe` (whitelist + forbidNonWhitelisted
 * + transform), which rejects unknown fields outright. Cross-field rules
 * (date ordering, "trialing needs a trial end", plan/school existence, plan
 * activation, duplicate live subscriptions) are enforced in the service layer
 * with the zod schemas from `@school-bus-tracking/validation`, next to the
 * other business rules — exactly like the plan DTOs.
 *
 * `status: 'none'` is deliberately not accepted anywhere: it is a read-time
 * projection for "this school has no subscription", never a stored state.
 */

const ISO_MESSAGE = (field: string): string => `${field} must be a valid ISO-8601 date-time`;

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription`. */
export class CreateSchoolSubscriptionDto implements AdminSchoolSubscriptionCreateRequest {
  @IsUUID('4', { message: 'plan_id must be a valid UUID' })
  plan_id!: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES, {
    message: 'status must be one of trialing, active, past_due',
  })
  status?: SubscriptionStatus;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('trial_start') })
  trial_start?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('trial_end') })
  trial_end?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('current_period_start') })
  current_period_start?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('current_period_end') })
  current_period_end?: string | null;
}

/**
 * Body of `PATCH /api/v1/admin/schools/:schoolId/subscription`.
 *
 * Supplying a different `plan_id` performs a plan change: the current
 * subscription is closed and kept as history, and a new subscription row is
 * created on the new plan.
 */
export class UpdateSchoolSubscriptionDto implements AdminSchoolSubscriptionUpdateRequest {
  @IsOptional()
  @IsUUID('4', { message: 'plan_id must be a valid UUID' })
  plan_id?: string;

  @IsOptional()
  @IsIn(PERSISTED_SUBSCRIPTION_STATUS_VALUES, {
    message: 'status must be one of trialing, active, past_due, cancelled, expired',
  })
  status?: SubscriptionStatus;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('trial_start') })
  trial_start?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('trial_end') })
  trial_end?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('current_period_start') })
  current_period_start?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('current_period_end') })
  current_period_end?: string | null;
}

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription/cancel`. */
export class CancelSchoolSubscriptionDto implements AdminSchoolSubscriptionCancelRequest {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: ISO_MESSAGE('cancelled_at') })
  cancelled_at?: string | null;
}
