import { ApiClientError } from '@school-bus-tracking/api-client';
import { localizeApiError, type LocalizedApiError } from './i18n.ts';
import {
  FIX_HIGHLIGHTED_FIELDS,
  fieldErrorMessage,
  isRawValidationText,
  mapApiValidationErrors,
  type FieldLabelMap,
} from './field-errors.ts';
import {
  USER_MESSAGES,
  isNetworkFailureMessage,
  isTechnicalMessage,
  sanitizeUserFacingMessage,
  statusFallbackMessage,
  type ErrorMessageContext,
} from './error-messages.ts';

/**
 * Mobile port of the shared error helpers used by the web app: both clients
 * read the same API envelope (nested `error.message` / `error.details`,
 * network failures, session expiry) instead of raw fetch errors.
 *
 * The mobile app is deliberately **stricter** than the web console on one
 * point — it classifies a message before showing it. The console is used by
 * staff on a desktop; the phone is used by a driver at the wheel and by a
 * parent at the school gate, so `Request failed with status 401` is never
 * acceptable copy on any of its screens. The classification lives in
 * `./error-messages.ts` and is shared with the localised crew path
 * (`lib/i18n.ts`) and the offline banner (`features/crew/offline/queue-core.ts`).
 *
 * ### The one rule
 *
 * **No technical text ever reaches a screen.** An error that reaches the UI is
 * mapped to a sentence a user can act on, and a technical message — the API
 * client's `Request failed with status 401`, a proxy's HTML page, a Nest
 * default `{"statusCode":500,"message":"Internal server error"}`, a Postgres
 * error, a stack trace, an axios `Network Error` — is *classified* (see
 * `./error-messages.ts`) and replaced. A server message that is actually
 * useful ("A student with this admission number already exists.", "You've
 * reached your plan limit of 50 buses.") is passed through verbatim: it is
 * more specific than anything the app could invent, and the server owns the
 * business rule.
 *
 * Order of preference, per error:
 *
 * 1. a safe message from the API envelope (`error.message`, `error.details`);
 * 2. a safe message from the thrown `Error` (only when it is not the client's
 *    own diagnostic — `ApiClientError.message` is *never* shown, because the
 *    client builds it from the status and a slice of the raw body);
 * 3. the status-based copy in the caller's context (login vs signed-in);
 * 4. the caller's fallback sentence.
 */

export {
  USER_MESSAGES,
  isNetworkFailureError,
  isNetworkFailureMessage,
  isRawDocumentBody,
  isTechnicalMessage,
  sanitizeUserFacingMessage,
  statusFallbackMessage,
  type ErrorMessageContext,
} from './error-messages.ts';

/** Per-call presentation hints. */
export interface ApiErrorMessageOptions {
  /**
   * `'login'` maps a 401 to "Invalid email or password…" instead of the
   * signed-in "Your session has expired…". Defaults to `'session'`.
   */
  context?: ErrorMessageContext;
}

function readMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    // A validator's own words are not a message. `email must be an email` passes
    // every technical check (it is plain prose) and still tells a driver nothing,
    // so it is dropped here and the caller falls back to its own sentence — the
    // per-field path in `field-errors.ts` is what turns it into guidance.
    if (isRawValidationText(value)) {
      return null;
    }
    return sanitizeUserFacingMessage(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => readMessage(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      const fromNested = readMessage(nested.message) ?? readMessage(nested.details);
      if (fromNested) return fromNested;
    }
    const fromMessage = readMessage(record.message);
    if (fromMessage) return fromMessage;
    const fromDetails = readMessage(record.details);
    if (fromDetails) return fromDetails;
  }
  return null;
}

/**
 * The user-facing message for a thrown error.
 *
 * Never returns an HTTP status code, a raw document, a stack trace or the API
 * client's own diagnostic string — see the module doc for the precedence
 * order. `fallback` is the screen's own sentence for the cases with no
 * status-specific copy; it is sanitised too, so a bad fallback cannot leak.
 */
export function getApiErrorMessage(
  error: unknown,
  fallback: string = USER_MESSAGES.unknown,
  options: ApiErrorMessageOptions = {},
): string {
  const context = options.context ?? 'session';
  const safeFallback = sanitizeUserFacingMessage(fallback) ?? USER_MESSAGES.unknown;

  if (error instanceof ApiClientError) {
    // 1. The API's own message, when it is something a person can act on.
    const fromDetails = readMessage(error.details);
    if (fromDetails) return fromDetails;
    // 2. Never `error.message`: the client builds it as
    //    `Request failed with status <n>` (plus a slice of the raw body for a
    //    non-JSON response). It is a diagnostic, not copy.
    return statusFallbackMessage(error.status, safeFallback, context);
  }

  if (error instanceof Error && error.message) {
    // 3. An app-thrown error ("Could not dispatch the trip.", a Zod message)
    //    is copy; a transport/framework error is not.
    if (isTechnicalMessage(error.message)) {
      return isNetworkFailureMessage(error.message) ? USER_MESSAGES.network : safeFallback;
    }
    return error.message;
  }

  return safeFallback;
}

/**
 * Localised twin of {@link getApiErrorMessage} (Phase 3).
 *
 * `getApiErrorMessage` stays the English contract; this helper adds the
 * localisation step on top for the surfaces that want it:
 *
 * - a **known** error code (`HTTP_409`, `RATE_LIMIT_EXCEEDED`…) → the app's own
 *   copy in the active locale;
 * - an **unknown** code → the server's message as-is plus a visible
 *   "Server code XYZ" note, so support still gets the exact code;
 * - `HTTP_403` → the server's own message always wins (documented taxonomy);
 * - **no code at all** → the locale's copy for the status (a bare 401/500 on a
 *   crew screen still reads as a sentence in Hindi or Marathi);
 * - a message that is actually a diagnostic → dropped, so it can never ride
 *   through under an unknown code.
 *
 * Note what is *not* passed on: the English sentence `getApiErrorMessage`
 * would have produced. Handing that to `localizeApiError` as if it were a
 * server message would defeat the localisation (and mark the result "not
 * localized"); the API's own message is the only thing worth forwarding, and
 * `localizeApiError` owns everything else.
 */
export function getLocalizedApiError(error: unknown): LocalizedApiError {
  if (error instanceof ApiClientError) {
    const details = error.details as { error?: { code?: unknown } } | undefined;
    const rawCode = details?.error?.code;
    return localizeApiError({
      code: typeof rawCode === 'string' ? rawCode : null,
      message: readMessage(error.details),
      status: error.status,
    });
  }
  const message = error instanceof Error ? readMessage(error.message) : null;
  return localizeApiError({ code: null, message, status: null });
}

/** The slice of a Zod error the form helpers need (mirrors the web helper). */
export interface ZodIssueLike {
  path: ReadonlyArray<string | number>;
  message: string;
}

export interface ZodErrorLike {
  issues: ReadonlyArray<ZodIssueLike>;
}

/**
 * Maps a Zod error to the `field -> message` keys the login form renders.
 * Paths are joined with dots, so nested schemas behave like on the web.
 *
 * The schema's own wording is *never* what gets rendered: each issue is turned
 * into a sentence naming the field as this form labels it (`field-errors.ts`),
 * because a driver at the school gate cannot act on
 * `String must contain at least 8 character(s)`.
 */
export function fieldErrorsFromZod(
  error: ZodErrorLike,
  labels?: FieldLabelMap,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      continue;
    }
    const key = issue.path.join('.');
    if (!result[key]) {
      result[key] = fieldErrorMessage(issue.message, key, labels);
    }
  }
  return result;
}

/** Object-level Zod messages that belong to no single field. */
export function formErrorsFromZod(error: ZodErrorLike): string[] {
  return error.issues
    .filter((issue) => issue.path.length === 0)
    .map((issue) => issue.message)
    // Schema jargon is not a sentence to show above a form; a superRefine that
    // says "Expiry must be after the issue date." survives.
    .filter((message) => !isRawValidationText(message));
}

export function unwrapEnvelope<T>(
  envelope: {
    success: boolean;
    data?: T;
    message?: string;
    error?: { message: string; code?: string };
  },
  fallback = 'Request failed',
): T {
  if (envelope.data !== undefined) {
    return envelope.data;
  }
  // A `success: false` envelope is a business rejection; only its safe,
  // human-readable message may surface (never a diagnostic or a raw body).
  throw new Error(
    readMessage(envelope.error) ?? sanitizeUserFacingMessage(envelope.message) ?? fallback,
  );
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Per-field guidance for any API failure, keyed by the screen's own field names.
 *
 * The API returns either a per-field map or (for the DTO validation pipe) a flat
 * array of friendly sentences, and both arrive here. A message that is a
 * diagnostic — `Request failed with status 422`, a raw document — is dropped
 * rather than rendered under an input, so the form falls back to its own copy.
 *
 * `fields` is the form's label map (`pickFieldLabels([...])`): the API names what
 * it rejected in prose, so prose-to-input attribution is done by label, and only
 * the screen knows what its inputs are called.
 */
export function fieldErrorsFromUnknown(
  error: unknown,
  fields?: string[] | FieldLabelMap,
): Record<string, string> {
  return mapApiValidationErrors(error, fields).fieldErrors;
}

/**
 * The sentence for a form's own error line after a rejected submission: the
 * server's guidance that belongs to no single input, or the "highlighted
 * fields" line when every problem did land on an input.
 */
export function submitErrorMessage(error: unknown, fields?: string[] | FieldLabelMap): string {
  const mapping = mapApiValidationErrors(error, fields);
  const line = mapping.formErrors.join(' ');
  if (line.length > 0) return line;
  return Object.keys(mapping.fieldErrors).length > 0 ? FIX_HIGHLIGHTED_FIELDS : '';
}
