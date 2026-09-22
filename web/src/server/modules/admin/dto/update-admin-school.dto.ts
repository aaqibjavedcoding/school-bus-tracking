import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AdminSchoolUpdateRequest } from '@school-bus-tracking/shared-types';

/**
 * Body of `PATCH /api/v1/admin/schools/:id`.
 *
 * Profile fields only. Identity and ownership fields (`id`, `code`,
 * `subdomain`) cannot be mutated through this endpoint, there is no
 * `is_active` (lifecycle goes through the explicit activate/deactivate
 * endpoints) and the global pipe rejects any unknown field. At least one
 * field must be present; the service additionally guarantees the body is not
 * an empty object.
 */
export class UpdateAdminSchoolDto implements AdminSchoolUpdateRequest {
  @IsOptional()
  @IsString({ message: 'Please enter a valid name.' })
  @IsNotEmpty({ message: 'Please enter the name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  @MaxLength(255, { message: 'Please enter at most 255 characters for the email address.' })
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Please enter at most 32 characters for the phone number.' })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Please enter at most 255 characters for the address line 1.' })
  address_line1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Please enter at most 255 characters for the address line 2.' })
  address_line2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Please enter at most 100 characters for the city.' })
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Please enter at most 100 characters for the state.' })
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Please enter at most 20 characters for the postal code.' })
  postal_code?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'Please enter a valid 2-letter country code.' })
  country?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Please enter the timezone.' })
  @MaxLength(64, { message: 'Please enter at most 64 characters for the timezone.' })
  timezone?: string;
}
