import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AdminSchoolSubscriptionCancelRequest,
  AdminSchoolSubscriptionCreateRequest,
  AdminSchoolSubscriptionUpdateRequest,
  ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES,
  PERSISTED_SUBSCRIPTION_STATUS_VALUES,
  SubscriptionStatus,
  SUBSCRIPTION_STATUS_VALUES,
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

const ISO_MESSAGE = (field: string): string =>
  `Please enter the ${field.replace(/_/g, ' ')} as a date and time, for example 2026-04-01T08:30:00Z.`;

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription`. */
export class CreateSchoolSubscriptionDto implements AdminSchoolSubscriptionCreateRequest {
  @IsUUID('4', { message: 'Please select a valid plan.' })
  plan_id!: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES, {
    message: 'Please select a valid subscription status (one of: trialing, active, past_due).',
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
  @IsUUID('4', { message: 'Please select a valid plan.' })
  plan_id?: string;

  @IsOptional()
  @IsIn(PERSISTED_SUBSCRIPTION_STATUS_VALUES, {
    message:
      'Please select a valid subscription status (one of: trialing, active, past_due, cancelled, expired).',
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

/**
 * Query string of `GET /api/v1/admin/subscriptions` (global platform view).
 *
 * Unlike the school-scoped subscription DTOs, `status` accepts the
 * projection-only `none` because a platform operator filters the list by
 * "schools with no subscription" directly; the service never persists it.
 */
export class ListAdminSubscriptionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page number.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page number.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page size.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page size.' })
  @Max(100, { message: 'Please enter a value of at most 100 for the page size.' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'Please enter a valid search text.' })
  // `MaxLength` (not `Max`, which only constrains numbers) is what actually
  // bounds a free-text query — the same guard the schools/plans list DTOs use.
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUS_VALUES, {
    message:
      'Please select a valid subscription status (one of: none, trialing, active, past_due, cancelled, expired).',
  })
  status?: SubscriptionStatus;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid plan.' })
  plan_id?: string;
}
