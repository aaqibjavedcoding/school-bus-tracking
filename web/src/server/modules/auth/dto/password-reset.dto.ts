import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_TOKEN_LENGTH,
} from '@school-bus-tracking/validation';
import type {
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '@school-bus-tracking/shared-types';

import { UUID_OR_SCHOOL_CODE } from './login.dto';

/**
 * Body of `POST /api/v1/auth/forgot-password`.
 *
 * `school_id` is **required** here, unlike {@link LoginDto} where it is
 * omitted for the platform SUPER_ADMIN: self-service reset is SCHOOL_ADMIN
 * only, and a school admin always belongs to exactly one tenant. It accepts
 * the same UUID-or-code union login accepts, so the forgot-password form can
 * carry the identical "School code" field the login form has.
 *
 * ### Validation messages must stay identity-neutral
 *
 * These messages describe the *shape* of what was typed ("please enter a
 * valid email address"), never whether it matched anything. The endpoint's
 * success response is a single fixed sentence for every outcome
 * (`FORGOT_PASSWORD_GENERIC_MESSAGE`); a 400 that said more than "this is not
 * an email" would reintroduce the enumeration channel that response exists to
 * close.
 */
export class ForgotPasswordDto implements ForgotPasswordRequest {
  @IsString({ message: 'Please enter your school code.' })
  @IsNotEmpty({ message: 'Please enter your school code.' })
  @MaxLength(63, { message: 'Please enter a school code of at most 63 characters.' })
  @Matches(UUID_OR_SCHOOL_CODE, { message: 'Please enter your school code.' })
  school_id!: string;

  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email!: string;
}

/**
 * Body of `POST /api/v1/auth/reset-password`.
 *
 * The password rules mirror the shared `passwordSchema` the reset page
 * enforces in the browser (minimum length, no leading/trailing whitespace),
 * so a reset can never mint a credential the console would have refused. They
 * are written as class-validator decorators for the same reason
 * `ResetSchoolAdminPasswordDto` is: the global `ValidationPipe` is what
 * produces this API's error envelope, and a zod parse inside the handler
 * would produce a differently-shaped one for the same class of mistake.
 * `password-reset.dto.spec.ts` pins the two against each other.
 *
 * The **token** is only shape-checked here. Its authenticity is decided by a
 * digest lookup in `PasswordResetService`, and every failure there collapses
 * to one message — so this DTO must not try to be clever about which tokens
 * "look real".
 */
export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString({ message: 'This password reset link is not valid.' })
  @IsNotEmpty({ message: 'This password reset link is not valid.' })
  @MaxLength(PASSWORD_RESET_TOKEN_LENGTH, {
    message: 'This password reset link is not valid.',
  })
  token!: string;

  @IsString({ message: 'Please enter a valid password.' })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Please enter at least ${MIN_PASSWORD_LENGTH} characters for the password.`,
  })
  @MaxLength(72, { message: 'Please enter at most 72 characters for the password.' })
  @Matches(/^\S.*\S$|^\S$/, { message: 'Please do not start or end the password with a space.' })
  password!: string;
}
