import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StaffCreateRequest } from '@school-bus-tracking/shared-types';
import { MIN_PASSWORD_LENGTH } from '@school-bus-tracking/validation';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Body of `POST /api/v1/drivers` and `POST /api/v1/conductors`.
 *
 * The DTO intentionally has no `school_id` or `role`: the authenticated
 * school admin supplies neither. The controller takes the tenant from the
 * verified JWT and pins the staff role per resource (`DRIVER` or
 * `CONDUCTOR`). A client sending those fields is rejected by the global
 * whitelist pipe (see the DTO tests).
 */
export class CreateStaffDto implements StaffCreateRequest {
  @IsString({ message: 'first_name must be a string' })
  @IsNotEmpty({ message: 'first_name is required' })
  @MaxLength(100, { message: 'first_name must be at most 100 characters' })
  @Transform(trimValue)
  first_name!: string;

  @IsString({ message: 'last_name must be a string' })
  @IsNotEmpty({ message: 'last_name is required' })
  @MaxLength(100, { message: 'last_name must be at most 100 characters' })
  @Transform(trimValue)
  last_name!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must be at most 255 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
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

  @IsOptional()
  @IsString({ message: 'phone must be a string' })
  @MaxLength(32, { message: 'phone must be at most 32 characters' })
  @Transform(trimValue)
  declare phone?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
