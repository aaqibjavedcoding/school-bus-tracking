import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SchoolOnboardingRequest } from '@school-bus-tracking/shared-types';
import { MIN_PASSWORD_LENGTH } from '@school-bus-tracking/validation';

/**
 * Nested `school` object of the onboarding body.
 *
 * Messages must NOT carry a `school.` prefix: this class is reached through
 * `@ValidateNested()`, and Nest's global `ValidationPipe` already prepends the
 * parent path to every child constraint
 * (`${parentPath}.${message}` in `prependConstraintsWithParentProp`). A
 * prefixed message here is therefore reported as `school.school.code …`.
 */
export class SchoolDetailsDto {
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
}

/** Nested `admin` object of the onboarding body — same prefix rule as above. */
export class AdminDetailsDto {
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(200, { message: 'name must be at most 200 characters' })
  @Matches(/\S+\s+\S+/, {
    message: 'name must include first and last name',
  })
  name!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must be at most 255 characters' })
  email!: string;

  @IsString({ message: 'password must be a string' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, {
    message: 'password must not start or end with whitespace',
  })
  password!: string;
}

/**
 * Body of `POST /api/v1/schools` — school onboarding.
 *
 * Implements the shared `SchoolOnboardingRequest` contract and is validated by
 * the global `ValidationPipe` (whitelist + forbidNonWhitelisted). The school
 * code follows the platform-wide tenant code rules (lowercase alphanumeric
 * segments joined by hyphens, max 32 chars); the admin password follows the
 * shared password policy in `@school-bus-tracking/validation`.
 *
 * The nested blocks keep their own constraint messages free of a `school.` /
 * `admin.` prefix; Nest prepends the parent path when it flattens the error
 * (see the note on {@link SchoolDetailsDto}).
 */
export class OnboardSchoolDto implements SchoolOnboardingRequest {
  @IsDefined({ message: 'school is required' })
  @IsObject({ message: 'school must be an object' })
  @ValidateNested()
  @Type(() => SchoolDetailsDto)
  school!: SchoolDetailsDto;

  @IsDefined({ message: 'admin is required' })
  @IsObject({ message: 'admin must be an object' })
  @ValidateNested()
  @Type(() => AdminDetailsDto)
  admin!: AdminDetailsDto;
}
