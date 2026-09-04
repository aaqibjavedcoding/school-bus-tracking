import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { LoginRequest } from '@school-bus-tracking/shared-types';

/**
 * A school tenant identifier: either a UUID (`9d079696-25be-47de-9128-fb3ccde11854`)
 * or the school's human-friendly tenant code (`lincoln-high`).
 */
const UUID_OR_SCHOOL_CODE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9]+(?:-[a-z0-9]+)*)$/i;

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
 * `school_id` identifies the tenant for school users and may be the school's
 * UUID or its tenant `code`; the service resolves a code to the matching
 * tenant. A platform SUPER_ADMIN belongs to no tenant and logs in with it
 * omitted (or null); an empty string from a browser form is normalized to
 * null by the client and accepted here as absent.
 */
export class LoginDto implements LoginRequest {
  @IsOptional()
  @ValidateIf((object: LoginDto) => object.school_id !== null)
  @IsString({ message: 'school_id must be a string' })
  @MaxLength(63, { message: 'school_id must be at most 63 characters' })
  @Matches(UUID_OR_SCHOOL_CODE, { message: 'school_id must be a valid UUID or school code' })
  school_id?: string | null;

  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  password!: string;
}
