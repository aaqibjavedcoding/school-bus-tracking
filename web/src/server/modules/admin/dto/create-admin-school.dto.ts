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
  @IsString({ message: 'Please enter a valid school name.' })
  @IsNotEmpty({ message: 'Please enter a value for the school name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the school name.' })
  name!: string;

  @IsString({ message: 'Please enter a valid school code.' })
  @MinLength(2, { message: 'Please enter at least 2 characters for the school code.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the school code.' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Please use lowercase letters, numbers and hyphens for the school code.',
  })
  code!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid school subdomain.' })
  @MaxLength(63, { message: 'Please enter at most 63 characters for the school subdomain.' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Please use lowercase letters, numbers and hyphens for the school subdomain.',
  })
  subdomain?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Please enter at most 255 characters for the school email address.' })
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Please enter at most 32 characters for the school phone number.' })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Please enter at most 255 characters for the school address line 1.' })
  address_line1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Please enter at most 255 characters for the school address line 2.' })
  address_line2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Please enter at most 100 characters for the school city.' })
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Please enter at most 100 characters for the school state.' })
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Please enter at most 20 characters for the school postal code.' })
  postal_code?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'Please enter a valid 2-letter country code.' })
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'Please enter at most 64 characters for the school timezone.' })
  timezone?: string;
}

export class AdminSchoolInitialAdminDto {
  @IsString({ message: 'Please enter a valid admin first name.' })
  @IsNotEmpty({ message: 'Please enter a value for the admin first name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the admin first name.' })
  first_name!: string;

  @IsString({ message: 'Please enter a valid admin last name.' })
  @IsNotEmpty({ message: 'Please enter a value for the admin last name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the admin last name.' })
  last_name!: string;

  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Please enter at most 255 characters for the admin email address.' })
  email!: string;

  @IsString({ message: 'Please enter a valid admin password.' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Please enter at least ${MIN_PASSWORD_LENGTH} characters for the admin password.`,
  })
  @MaxLength(72, { message: 'Please enter at most 72 characters for the admin password.' })
  @Matches(/^\S.*\S$|^\S$/, {
    message: 'Please do not start or end the admin password with a space.',
  })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Please enter at most 32 characters for the admin phone number.' })
  phone?: string | null;
}

export class CreateAdminSchoolDto implements AdminSchoolCreateRequest {
  @IsDefined({ message: 'Please provide the school details.' })
  @IsObject({ message: 'Please provide the school as an object.' })
  @ValidateNested()
  @Type(() => AdminSchoolProfileDto)
  school!: AdminSchoolProfileDto;

  @IsDefined({ message: 'Please provide the admin details.' })
  @IsObject({ message: 'Please provide the admin as an object.' })
  @ValidateNested()
  @Type(() => AdminSchoolInitialAdminDto)
  admin!: AdminSchoolInitialAdminDto;
}
