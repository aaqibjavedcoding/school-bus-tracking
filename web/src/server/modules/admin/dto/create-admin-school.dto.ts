import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AdminSchoolCreateRequest } from '@school-bus-tracking/shared-types';
import { MIN_PASSWORD_LENGTH } from '@school-bus-tracking/validation';

/**
 * Body of `POST /api/v1/admin/schools`.
 *
 * Validated by the global `ValidationPipe` (whitelist +
 * forbidNonWhitelisted), so any client-supplied `id`, `is_active`, `role` or
 * extra field is rejected rather than silently stripped. The role is pinned
 * server-side to SCHOOL_ADMIN and the tenant relationship is always derived
 * from the created school — a client can never set either.
 */
export class AdminSchoolProfileDto {
  @IsString({ message: 'school.name must be a string' })
  @IsNotEmpty({ message: 'school.name is required' })
  @MaxLength(150, { message: 'school.name must be at most 150 characters' })
  name!: string;

  @IsString({ message: 'school.code must be a string' })
  @MinLength(2, { message: 'school.code must be at least 2 characters' })
  @MaxLength(32, { message: 'school.code must be at most 32 characters' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'school.code must be lowercase alphanumeric segments separated by hyphens',
  })
  code!: string;

  @IsOptional()
  @IsString({ message: 'school.subdomain must be a string' })
  @MaxLength(63, { message: 'school.subdomain must be at most 63 characters' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'school.subdomain must be lowercase alphanumeric segments separated by hyphens',
  })
  subdomain?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'school.email must be a valid email address' })
  @MaxLength(255, { message: 'school.email must be at most 255 characters' })
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'school.phone must be at most 32 characters' })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'school.address_line1 must be at most 255 characters' })
  address_line1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'school.address_line2 must be at most 255 characters' })
  address_line2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'school.city must be at most 100 characters' })
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'school.state must be at most 100 characters' })
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'school.postal_code must be at most 20 characters' })
  postal_code?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'school.country must be a 2-letter ISO country code' })
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'school.timezone must be at most 64 characters' })
  timezone?: string;
}

export class AdminSchoolInitialAdminDto {
  @IsString({ message: 'admin.first_name must be a string' })
  @IsNotEmpty({ message: 'admin.first_name is required' })
  @MaxLength(100, { message: 'admin.first_name must be at most 100 characters' })
  first_name!: string;

  @IsString({ message: 'admin.last_name must be a string' })
  @IsNotEmpty({ message: 'admin.last_name is required' })
  @MaxLength(100, { message: 'admin.last_name must be at most 100 characters' })
  last_name!: string;

  @IsEmail({}, { message: 'admin.email must be a valid email address' })
  @MaxLength(255, { message: 'admin.email must be at most 255 characters' })
  email!: string;

  @IsString({ message: 'admin.password must be a string' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `admin.password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'admin.password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'admin.password must not start or end with whitespace' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'admin.phone must be at most 32 characters' })
  phone?: string | null;
}

export class CreateAdminSchoolDto implements AdminSchoolCreateRequest {
  @IsDefined({ message: 'school is required' })
  @IsObject({ message: 'school must be an object' })
  @ValidateNested()
  @Type(() => AdminSchoolProfileDto)
  school!: AdminSchoolProfileDto;

  @IsDefined({ message: 'admin is required' })
  @IsObject({ message: 'admin must be an object' })
  @ValidateNested()
  @Type(() => AdminSchoolInitialAdminDto)
  admin!: AdminSchoolInitialAdminDto;
}
