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

  @IsOptional()
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/admin/schools/:id/admins/:adminId`. */
export class UpdateSchoolAdminDto implements AdminSchoolAdminUpdateRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'first_name is required' })
  @MaxLength(100, { message: 'first_name must be at most 100 characters' })
  first_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'last_name is required' })
  @MaxLength(100, { message: 'last_name must be at most 100 characters' })
  last_name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must be at most 255 characters' })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'password must not start or end with whitespace' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'phone must be at most 32 characters' })
  phone?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;
}

/** Body of `POST .../admins/:adminId/reset-password`. */
export class ResetSchoolAdminPasswordDto implements AdminSchoolAdminResetPasswordRequest {
  @IsString({ message: 'password must be a string' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'password must not start or end with whitespace' })
  password!: string;
}

/** Query string of `GET /api/v1/admin/schools/:id/admins`. */
export class ListSchoolAdminsQueryDto {
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
}
