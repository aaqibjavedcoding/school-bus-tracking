import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PlanBillingPeriod } from '@school-bus-tracking/shared-types';
// Types referenced in decorated signatures must be imported as types when
// `isolatedModules` + `emitDecoratorMetadata` are on (the Next build).
import type { PlanFeaturesConfig, PlanLimitsConfig } from '@school-bus-tracking/shared-types';
import { Transform, Type } from 'class-transformer';

/**
 * Strict NestJS DTOs for the Super Admin plan catalog.
 *
 * Validated by the global `ValidationPipe` (whitelist + forbidNonWhitelisted
 * + transform). The `features` and `limits` values are deeply validated in
 * the service layer using the zod schemas from `@school-bus-tracking/validation`,
 * which reject unknown keys and enforce the `unlimited → value is null`
 * invariant — class-validator has no ergonomic record-of-known-keys
 * primitive, so deep validation is centralised alongside other business rules.
 */

const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Body of `POST /api/v1/admin/plans`. */
export class CreateAdminPlanDto {
  @IsString({ message: 'Please enter a valid code.' })
  @MinLength(2, { message: 'Please enter at least 2 characters for the code.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the code.' })
  @Matches(CODE_PATTERN, {
    message: 'Please use lowercase letters, numbers and hyphens for the code.',
  })
  code!: string;

  @IsString({ message: 'Please enter a valid name.' })
  @MinLength(1, { message: 'Please enter the name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the name.' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid description.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the description.' })
  description?: string | null;

  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Please enter a valid price with up to 2 decimals.' },
  )
  @Min(0, { message: 'Please enter a price of zero or more.' })
  price!: number;

  @IsString({ message: 'Please enter a valid currency.' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'Please enter a valid 3-letter currency code.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency!: string;

  @IsIn([PlanBillingPeriod.MONTHLY, PlanBillingPeriod.YEARLY], {
    message: 'Please select a valid billing period (one of: monthly, yearly).',
  })
  billing_period!: PlanBillingPeriod;

  @IsOptional()
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  is_active?: boolean;

  @IsOptional()
  @IsObject({ message: 'Please provide the features as an object.' })
  features?: PlanFeaturesConfig;

  @IsOptional()
  @IsObject({ message: 'Please provide the limits as an object.' })
  limits?: PlanLimitsConfig;
}

/** Body of `PATCH /api/v1/admin/plans/:id`. */
export class UpdateAdminPlanDto {
  @IsOptional()
  @IsString({ message: 'Please enter a valid name.' })
  @MinLength(1, { message: 'Please enter the name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the name.' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid description.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the description.' })
  description?: string | null;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Please enter a valid price with up to 2 decimals.' },
  )
  @Min(0, { message: 'Please enter a price of zero or more.' })
  price?: number;

  @IsOptional()
  @IsString({ message: 'Please enter a valid currency.' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'Please enter a valid 3-letter currency code.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency?: string;

  @IsOptional()
  @IsIn([PlanBillingPeriod.MONTHLY, PlanBillingPeriod.YEARLY], {
    message: 'Please select a valid billing period (one of: monthly, yearly).',
  })
  billing_period?: PlanBillingPeriod;

  @IsOptional()
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  is_active?: boolean;

  @IsOptional()
  @IsObject({ message: 'Please provide the features as an object.' })
  features?: PlanFeaturesConfig;

  @IsOptional()
  @IsObject({ message: 'Please provide the limits as an object.' })
  limits?: PlanLimitsConfig;
}

/** Query string of `GET /api/v1/admin/plans`. */
export class ListAdminPlansQueryDto {
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
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], {
    message: 'Please select a valid status (one of: active, inactive).',
  })
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(['created_at', 'name', 'code', 'price'], {
    message: 'Please select a valid sort field (one of: created_at, name, code, price).',
  })
  sort?: 'created_at' | 'name' | 'code' | 'price';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'Please select a valid sort direction (one of: asc, desc).' })
  order?: 'asc' | 'desc';
}
