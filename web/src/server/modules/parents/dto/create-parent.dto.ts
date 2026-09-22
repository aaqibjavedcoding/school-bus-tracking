import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ParentCreateRequest } from '@school-bus-tracking/shared-types';
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
 * Body of `POST /api/v1/parents`.
 *
 * The DTO intentionally has no `school_id` or `role`: the authenticated
 * school admin supplies neither. The controller takes the tenant from the
 * verified JWT and the service always creates the fixed `PARENT` role.
 */
export class CreateParentDto implements ParentCreateRequest {
  @IsString({ message: 'Please enter a valid first name.' })
  @IsNotEmpty({ message: 'Please enter the first name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the first name.' })
  @Transform(trimValue)
  first_name!: string;

  @IsString({ message: 'Please enter a valid last name.' })
  @IsNotEmpty({ message: 'Please enter the last name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the last name.' })
  @Transform(trimValue)
  last_name!: string;

  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Please enter at most 255 characters for the email address.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString({ message: 'Please enter a valid password.' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Please enter at least ${MIN_PASSWORD_LENGTH} characters for the password.`,
  })
  @MaxLength(72, { message: 'Please enter at most 72 characters for the password.' })
  @Matches(/^\S.*\S$|^\S$/, {
    message: 'Please do not start or end the password with a space.',
  })
  password!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid phone number.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the phone number.' })
  @Transform(trimValue)
  declare phone?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
