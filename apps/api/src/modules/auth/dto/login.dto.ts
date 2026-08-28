import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { LoginRequest } from '@school-bus-tracking/shared-types';

/**
 * Body of `POST /api/v1/auth/login`.
 *
 * Implements the shared `LoginRequest` contract so the API cannot drift from
 * the web/mobile clients. Validated by the global `ValidationPipe`
 * (whitelist + forbidNonWhitelisted), so unknown fields are rejected.
 *
 * Deliberately minimal password rule: login only requires a non-empty string.
 * Password strength policy (`passwordSchema` in `@school-bus-tracking/validation`)
 * applies when credentials are created, not when they are checked — otherwise
 * a policy change could lock out existing users.
 *
 * `school_id` identifies the tenant for school users and must be a UUID when
 * present. A platform SUPER_ADMIN belongs to no tenant and logs in with it
 * omitted (or null); an empty string from a browser form is normalized to
 * null by the client and accepted here as absent.
 */
export class LoginDto implements LoginRequest {
  @IsOptional()
  @ValidateIf((object: LoginDto) => object.school_id !== null)
  @IsUUID(undefined, { message: 'school_id must be a valid UUID' })
  school_id?: string | null;

  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  password!: string;
}
