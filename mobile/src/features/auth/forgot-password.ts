import { forgotPasswordSchema, type ForgotPasswordInput } from '@school-bus-tracking/validation';
import type { ZodErrorLike } from '../../lib/errors.ts';

/**
 * The logic behind `app/forgot-password.tsx` — the mobile port of the web
 * console's `/forgot-password` step 1.
 *
 * Same split as `crew-login-flow.ts`: the screen is JSX plus `useState`,
 * everything that can be *wrong* lives here so `forgot-password.spec.ts` can
 * exercise it under plain `node --test`.
 *
 * ### What this port is NOT allowed to do
 *
 * - **No backend change, no api-client change.** The endpoint
 *   (`POST /auth/forgot-password`), its rate limit and its anti-enumeration
 *   behaviour already exist and are already tested; this screen is a second
 *   caller, nothing more.
 * - **No second copy of the validation rules.** The fields are parsed with
 *   the shared `forgotPasswordSchema` from `@school-bus-tracking/validation`
 *   — the same object the server validates the request body with — so the
 *   phone can never accept something the API rejects, or the reverse.
 * - **No outcome-dependent copy.** See {@link FORGOT_PASSWORD_FIELDS} and
 *   the screen's own notes: one sentence, every time.
 */

/** Fields of the form — the same two the login screen's email path has. */
export const FORGOT_PASSWORD_FIELDS = ['school_id', 'email'] as const;

/** Outcome of validating the form (mirrors the web helper's shape). */
export type FormParseResult<T> = { ok: true; value: T } | { ok: false; error: ZodErrorLike };

/**
 * Validates the form against the **shared** schema.
 *
 * `school_id` is required here, unlike the login screen where a blank field
 * means "the platform SUPER_ADMIN": self-service reset is for school
 * administrators, who always belong to a tenant ([DECISION 3] — crew and
 * parents are told to ask their school instead). Both values are trimmed
 * first so a pasted code with a trailing space is accepted rather than
 * lectured at.
 */
export function parseForgotPasswordForm(input: {
  schoolId: string;
  email: string;
}): FormParseResult<ForgotPasswordInput> {
  const parsed = forgotPasswordSchema.safeParse({
    school_id: input.schoolId.trim(),
    email: input.email.trim(),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: parsed.error as unknown as ZodErrorLike };
}

/**
 * Whether a failed request may say something other than the generic
 * sentence.
 *
 * **Only two things ever differ**, and both describe the *request* rather
 * than the account: a 400 (the shape check — "that is not an email") and a
 * 429 (the public reset rate limit). Everything else — 500, a dropped
 * connection, a timeout — is reported as the same confirmation the success
 * path shows.
 *
 * That last part is the subtle one. If a network error rendered "could not
 * send", an attacker could distinguish "mail server refused this address"
 * from "accepted", which is exactly the oracle the endpoint's generic
 * response was built to remove. The honest trade is that a genuinely failed
 * request looks like a successful one on this screen — the user's recourse
 * is identical either way: wait for the mail, then ask again.
 */
export function forgotPasswordErrorIsVisible(status: number | null | undefined): boolean {
  return status === 400 || status === 429;
}

/** The status carried by an api-client error, when it has one. */
export function errorStatus(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}
