import {
  forgotPasswordSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from '@school-bus-tracking/validation';
import type { ZodErrorLike } from '../../lib/errors';

/**
 * The logic behind `/forgot-password` and `/reset-password`, extracted from
 * the two pages.
 *
 * The pages themselves are JSX plus `useState`; everything that can be
 * *wrong* — what counts as a valid submission, what the user is told
 * afterwards, how a token is read out of a URL — lives here as pure functions
 * so `password-reset.spec.ts` can exercise it under `node --test` (the repo
 * has no DOM test runner). The same split `features/crew/crew-login.ts` uses.
 *
 * No React, no DOM, no API client — and, like every other spec'd helper in
 * `features/`, **no runtime relative imports**: the web specs run under
 * `node --experimental-strip-types`, whose ESM resolver has no extensionless
 * lookup, so this module only imports packages and types. Turning a rejection
 * into per-field sentences is therefore left to the caller, which already has
 * `fieldErrorsFromZod` — and keeps this file from growing a second, quieter
 * copy of the field-label registry.
 */

/** Fields of the forgot-password form (the same two the login form has). */
export const FORGOT_PASSWORD_FIELDS = ['school_id', 'email'] as const;

/** Fields of the reset form. */
export const RESET_PASSWORD_FIELDS = ['password', 'confirm_password', 'token'] as const;

/**
 * The one thing `/forgot-password` ever says after a submit.
 *
 * Word-for-word the server's `FORGOT_PASSWORD_GENERIC_MESSAGE`, and shown for
 * **every** outcome the request can have — matched admin, unmatched email,
 * wrong role, unknown school code. The page must never render anything that
 * varies with the answer, because the server deliberately does not tell it
 * one, and a UI that appeared to know would be a more convincing enumeration
 * oracle than the API ever was.
 */
export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for that school and email, a password reset email has been sent.';

/** Toast shown on `/login` after a successful reset. */
export const RESET_PASSWORD_SUCCESS_TOAST =
  'Password updated. Please sign in with your new password.';

/** Shown when the page is opened without a usable `?token=` in the URL. */
export const RESET_PASSWORD_MISSING_TOKEN_MESSAGE =
  'This password reset link is incomplete. Open the link from your email again, or request a new one.';

/** Shown when the two password fields disagree. */
export const PASSWORD_CONFIRMATION_MISMATCH_MESSAGE = 'The two passwords do not match.';

/**
 * Outcome of validating one of the two forms.
 *
 * The failure carries a zod-shaped error rather than a message map, so the
 * page hands it to the same `fieldErrorsFromZod(...)` every other form in the
 * console uses and gets the same humanised, per-field sentences.
 */
export type FormParseResult<T> = { ok: true; value: T } | { ok: false; error: ZodErrorLike };

/** A one-issue error for the rules that live outside the schema. */
function issue(field: string, message: string): ZodErrorLike {
  return { issues: [{ path: [field], message }] };
}

/**
 * Validates the forgot-password form against the **shared** schema.
 *
 * `school_id` is required here (unlike login, where a blank field means "the
 * platform SUPER_ADMIN"): self-service reset is SCHOOL_ADMIN-only, and a
 * school admin always belongs to a tenant. Trimming happens before the parse
 * so a pasted code with a trailing space is accepted rather than lectured at.
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
 * Validates the reset form: the shared `passwordSchema` rules **plus** the
 * confirmation match.
 *
 * The confirmation is checked *after* the schema so a user who typed a
 * too-short password twice is told the real problem ("at least 8 characters")
 * rather than being sent to fix a mismatch that does not exist. The mismatch
 * is attached to `confirm_password`, the field the user must change.
 *
 * A missing token surfaces as a `token` issue even though the page has no
 * token input: it is what the page renders as the "this link is incomplete"
 * state, and keeping it in the same result shape means the submit handler has
 * exactly one failure path.
 */
export function parseResetPasswordForm(input: {
  token: string | null;
  password: string;
  confirmPassword: string;
}): FormParseResult<ResetPasswordInput> {
  const parsed = resetPasswordSchema.safeParse({
    token: (input.token ?? '').trim(),
    password: input.password,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error as unknown as ZodErrorLike };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, error: issue('confirm_password', PASSWORD_CONFIRMATION_MISMATCH_MESSAGE) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Reads the reset token out of the page's query string.
 *
 * Accepts a `URLSearchParams`, a raw `?token=…` string, or `null`, so the page
 * can hand over `useSearchParams()` and a test can hand over a literal. An
 * absent, blank or whitespace-only value becomes `null` — the page renders the
 * "incomplete link" state rather than submitting an empty token and getting a
 * 400 the user cannot act on.
 */
export function resetTokenFromQuery(
  query: URLSearchParams | string | null | undefined,
): string | null {
  if (query === null || query === undefined) {
    return null;
  }
  const params = typeof query === 'string' ? new URLSearchParams(query.replace(/^\?/, '')) : query;
  const token = params.get('token')?.trim() ?? '';
  return token === '' ? null : token;
}

/**
 * The query flag a completed reset carries to the login page.
 *
 * A flag rather than the message itself: a login page that rendered arbitrary
 * text from its own URL would be a free phishing surface
 * ("?message=Your+account+was+suspended,+call+this+number"). The flag is the
 * only thing that crosses, and {@link RESET_PASSWORD_SUCCESS_TOAST} — a
 * constant in this module — is what is shown.
 */
export const LOGIN_RESET_SUCCESS_FLAG = 'reset';

/** `/login?reset=1`. */
export function loginPathAfterReset(): string {
  return `/login?${LOGIN_RESET_SUCCESS_FLAG}=1`;
}

/** True when the login page was reached by a completed password reset. */
export function isPostResetLogin(query: URLSearchParams | string | null | undefined): boolean {
  if (query === null || query === undefined) {
    return false;
  }
  const params = typeof query === 'string' ? new URLSearchParams(query.replace(/^\?/, '')) : query;
  return params.get(LOGIN_RESET_SUCCESS_FLAG) === '1';
}
