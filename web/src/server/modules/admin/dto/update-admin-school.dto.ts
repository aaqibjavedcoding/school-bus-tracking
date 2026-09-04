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
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(150, { message: 'name must be at most 150 characters' })
  name?: string;

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
  @IsNotEmpty({ message: 'timezone is required' })
  @MaxLength(64, { message: 'timezone must be at most 64 characters' })
  timezone?: string;
}
