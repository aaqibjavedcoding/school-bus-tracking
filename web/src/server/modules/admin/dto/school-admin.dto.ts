import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AdminSchoolAdminCreateRequest,
  AdminSchoolAdminResetPasswordRequest,
  AdminSchoolAdminUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { MIN_PASSWORD_LENGTH } from '@school-bus-tracking/validation';

/** Body of `POST /api/v1/admin/schools/:id/admins`. */
export class CreateSchoolAdminDto implements AdminSchoolAdminCreateRequest {
  @IsString({ message: 'Please enter a valid first name.' })
  @IsNotEmpty({ message: 'Please enter the first name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the first name.' })
  first_name!: string;

  @IsString({ message: 'Please enter a valid last name.' })
  @IsNotEmpty({ message: 'Please enter the last name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the last name.' })
  last_name!: string;

  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Please enter at most 255 characters for the email address.' })
  email!: string;

  @IsString({ message: 'Please enter a valid password.' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Please enter at least ${MIN_PASSWORD_LENGTH} characters for the password.`,
  })
  @MaxLength(72, { message: 'Please enter at most 72 characters for the password.' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'Please do not start or end the password with a space.' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Please enter at most 32 characters for the phone number.' })
  phone?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/admin/schools/:id/admins/:adminId`. */
export class UpdateSchoolAdminDto implements AdminSchoolAdminUpdateRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Please enter the first name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the first name.' })
  first_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Please enter the last name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the last name.' })
  last_name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Please enter at most 255 characters for the email address.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Please enter at least ${MIN_PASSWORD_LENGTH} characters for the password.`,
  })
  @MaxLength(72, { message: 'Please enter at most 72 characters for the password.' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'Please do not start or end the password with a space.' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Please enter at most 32 characters for the phone number.' })
  phone?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  is_active?: boolean;
}

/** Body of `POST .../admins/:adminId/reset-password`. */
export class ResetSchoolAdminPasswordDto implements AdminSchoolAdminResetPasswordRequest {
  @IsString({ message: 'Please enter a valid password.' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Please enter at least ${MIN_PASSWORD_LENGTH} characters for the password.`,
  })
  @MaxLength(72, { message: 'Please enter at most 72 characters for the password.' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'Please do not start or end the password with a space.' })
  password!: string;
}

/** Query string of `GET /api/v1/admin/schools/:id/admins`. */
export class ListSchoolAdminsQueryDto {
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
}
