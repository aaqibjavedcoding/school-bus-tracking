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
import { StaffUpdateRequest } from '@school-bus-tracking/shared-types';
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

/** Body of `PATCH /api/v1/drivers/:id` and `PATCH /api/v1/conductors/:id`. */
export class UpdateStaffDto implements StaffUpdateRequest {
  @IsOptional()
  @IsString({ message: 'first_name must be a string' })
  @IsNotEmpty({ message: 'first_name cannot be empty' })
  @MaxLength(100, { message: 'first_name must be at most 100 characters' })
  @Transform(trimValue)
  declare first_name?: string;

  @IsOptional()
  @IsString({ message: 'last_name must be a string' })
  @IsNotEmpty({ message: 'last_name cannot be empty' })
  @MaxLength(100, { message: 'last_name must be at most 100 characters' })
  @Transform(trimValue)
  declare last_name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must be at most 255 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  declare email?: string;

  @IsOptional()
  @IsString({ message: 'password must be a string' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  @Matches(/^\S.*\S$|^\S$/, {
    message: 'password must not start or end with whitespace',
  })
  declare password?: string;

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
