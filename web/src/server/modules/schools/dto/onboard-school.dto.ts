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
 * Body of `POST /api/v1/schools` — school onboarding.
 *
 * Implements the shared `SchoolOnboardingRequest` contract and is validated by
 * the global `ValidationPipe` (whitelist + forbidNonWhitelisted). The school
 * code follows the platform-wide tenant code rules (lowercase alphanumeric
 * segments joined by hyphens, max 32 chars); the admin password follows the
 * shared password policy in `@school-bus-tracking/validation`.
 */
export class SchoolDetailsDto {
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
}

export class AdminDetailsDto {
  @IsString({ message: 'admin.name must be a string' })
  @IsNotEmpty({ message: 'admin.name is required' })
  @MaxLength(200, { message: 'admin.name must be at most 200 characters' })
  @Matches(/\S+\s+\S+/, {
    message: 'admin.name must include first and last name',
  })
  name!: string;

  @IsEmail({}, { message: 'admin.email must be a valid email address' })
  @MaxLength(255, { message: 'admin.email must be at most 255 characters' })
  email!: string;

  @IsString({ message: 'admin.password must be a string' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `admin.password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'admin.password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, {
    message: 'admin.password must not start or end with whitespace',
  })
  password!: string;
}

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
