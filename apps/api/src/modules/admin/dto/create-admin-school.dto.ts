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
 * Nested `school` object of the create body.
 *
 * Messages must NOT carry a `school.` prefix: this class is reached through
 * `@ValidateNested()`, and Nest's global `ValidationPipe` already prepends the
 * parent path to every child constraint
 * (`${parentPath}.${message}` in `prependConstraintsWithParentProp`). A
 * prefixed message here is therefore reported as `school.school.code …`.
 */
export class AdminSchoolProfileDto {
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(150, { message: 'name must be at most 150 characters' })
  name!: string;

  @IsString({ message: 'code must be a string' })
  @MinLength(2, { message: 'code must be at least 2 characters' })
  @MaxLength(32, { message: 'code must be at most 32 characters' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'code must be lowercase alphanumeric segments separated by hyphens',
  })
  code!: string;

  @IsOptional()
  @IsString({ message: 'subdomain must be a string' })
  @MaxLength(63, { message: 'subdomain must be at most 63 characters' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'subdomain must be lowercase alphanumeric segments separated by hyphens',
  })
  subdomain?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must be at most 255 characters' })
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'phone must be at most 32 characters' })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'address_line1 must be at most 255 characters' })
  address_line1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'address_line2 must be at most 255 characters' })
  address_line2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'city must be at most 100 characters' })
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'state must be at most 100 characters' })
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'postal_code must be at most 20 characters' })
  postal_code?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter ISO country code' })
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'timezone must be at most 64 characters' })
  timezone?: string;
}

/** Nested `admin` object of the create body — same prefix rule as above. */
export class AdminSchoolInitialAdminDto {
  @IsString({ message: 'first_name must be a string' })
  @IsNotEmpty({ message: 'first_name is required' })
  @MaxLength(100, { message: 'first_name must be at most 100 characters' })
  first_name!: string;

  @IsString({ message: 'last_name must be a string' })
  @IsNotEmpty({ message: 'last_name is required' })
  @MaxLength(100, { message: 'last_name must be at most 100 characters' })
  last_name!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must be at most 255 characters' })
  email!: string;

  @IsString({ message: 'password must be a string' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'password must not start or end with whitespace' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'phone must be at most 32 characters' })
  phone?: string | null;
}

/**
 * Body of `POST /api/v1/admin/schools`.
 *
 * Validated by the global `ValidationPipe` (whitelist +
 * forbidNonWhitelisted), so any client-supplied `id`, `is_active`, `role` or
 * extra field is rejected rather than silently stripped. The role is pinned
 * server-side to SCHOOL_ADMIN and the tenant relationship is always derived
 * from the created school — a client can never set either.
 *
 * The nested blocks keep their own constraint messages free of a `school.` /
 * `admin.` prefix; Nest prepends the parent path when it flattens the error
 * (see the note on {@link AdminSchoolProfileDto}).
 */
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
