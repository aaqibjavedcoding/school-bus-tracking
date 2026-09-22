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
}

export class AdminDetailsDto {
  @IsString({ message: 'Please enter a valid admin name.' })
  @IsNotEmpty({ message: 'Please enter a value for the admin name.' })
  @MaxLength(200, { message: 'Please enter at most 200 characters for the admin name.' })
  @Matches(/\S+\s+\S+/, {
    message: 'Please enter both the first and the last name.',
  })
  name!: string;

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
}

export class OnboardSchoolDto implements SchoolOnboardingRequest {
  @IsDefined({ message: 'Please provide the school details.' })
  @IsObject({ message: 'Please provide the school as an object.' })
  @ValidateNested()
  @Type(() => SchoolDetailsDto)
  school!: SchoolDetailsDto;

  @IsDefined({ message: 'Please provide the admin details.' })
  @IsObject({ message: 'Please provide the admin as an object.' })
  @ValidateNested()
  @Type(() => AdminDetailsDto)
  admin!: AdminDetailsDto;
}
