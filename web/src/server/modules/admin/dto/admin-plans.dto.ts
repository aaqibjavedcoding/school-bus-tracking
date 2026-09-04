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
import {
  PlanBillingPeriod,
  PlanFeaturesConfig,
  PlanLimitsConfig,
} from '@school-bus-tracking/shared-types';
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
  @IsString({ message: 'code must be a string' })
  @MinLength(2, { message: 'code must be at least 2 characters' })
  @MaxLength(32, { message: 'code must be at most 32 characters' })
  @Matches(CODE_PATTERN, {
    message: 'code must be lowercase alphanumeric segments separated by hyphens',
  })
  code!: string;

  @IsString({ message: 'name must be a string' })
  @MinLength(1, { message: 'name is required' })
  @MaxLength(100, { message: 'name must be at most 100 characters' })
  name!: string;

  @IsOptional()
  @IsString({ message: 'description must be a string' })
  @MaxLength(2000, { message: 'description must be at most 2000 characters' })
  description?: string | null;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price must be a number with up to two decimals' })
  @Min(0, { message: 'price must be zero or positive' })
  price!: number;

  @IsString({ message: 'currency must be a string' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency!: string;

  @IsIn([PlanBillingPeriod.MONTHLY, PlanBillingPeriod.YEARLY], {
    message: 'billing_period must be either monthly or yearly',
  })
  billing_period!: PlanBillingPeriod;

  @IsOptional()
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;

  @IsOptional()
  @IsObject({ message: 'features must be an object' })
  features?: PlanFeaturesConfig;

  @IsOptional()
  @IsObject({ message: 'limits must be an object' })
  limits?: PlanLimitsConfig;
}

/** Body of `PATCH /api/v1/admin/plans/:id`. */
export class UpdateAdminPlanDto {
  @IsOptional()
  @IsString({ message: 'name must be a string' })
  @MinLength(1, { message: 'name is required' })
  @MaxLength(100, { message: 'name must be at most 100 characters' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'description must be a string' })
  @MaxLength(2000, { message: 'description must be at most 2000 characters' })
  description?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price must be a number with up to two decimals' })
  @Min(0, { message: 'price must be zero or positive' })
  price?: number;

  @IsOptional()
  @IsString({ message: 'currency must be a string' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency?: string;

  @IsOptional()
  @IsIn([PlanBillingPeriod.MONTHLY, PlanBillingPeriod.YEARLY], {
    message: 'billing_period must be either monthly or yearly',
  })
  billing_period?: PlanBillingPeriod;

  @IsOptional()
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;

  @IsOptional()
  @IsObject({ message: 'features must be an object' })
  features?: PlanFeaturesConfig;

  @IsOptional()
  @IsObject({ message: 'limits must be an object' })
  limits?: PlanLimitsConfig;
}

/** Query string of `GET /api/v1/admin/plans`. */
export class ListAdminPlansQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must be at most 100' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(100, { message: 'search must be at most 100 characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'status must be either active or inactive' })
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(['created_at', 'name', 'code', 'price'], {
    message: 'sort must be one of created_at, name, code, price',
  })
  sort?: 'created_at' | 'name' | 'code' | 'price';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order must be either asc or desc' })
  order?: 'asc' | 'desc';
}
