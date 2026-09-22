import { ApiClientError } from '@school-bus-tracking/api-client';
import {
  fieldErrorMessage,
  formMessageForInvalidSubmission,
  isRawValidationText,
  mapApiValidationErrors,
  type FieldLabelMap,
} from './field-errors.ts';

/**
 * True for a response body that is a *document*, not a message.
 *
 * The API always answers with the JSON envelope, but a request can still come
 * back as a framework-rendered page: Next's generic 500 page when a route
 * handler fails to even load (a stale/partial `web/dist`), a reverse proxy's
 * 502/504 page, or a login portal on a captive network. `ApiClientError`
 * faithfully keeps that raw body on `.details`; rendering it verbatim as the
 * error text is how the dashboard ended up showing `<!DOCTYPE html>…` and a
 * JSON blob instead of the UI.
 */
export function isRawDocumentBody(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const head = value.trimStart().slice(0, 256).toLowerCase();
  return (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<?xml') ||
    /^<[a-z][\s\S]*>/.test(head)
  );
}

/** User-facing text for an error the API did not describe itself. */
export function statusFallbackMessage(status: number, fallback: string): string {
  if (status === 0) {
    return 'Network error. Check your connection and try again.';
  }
  if (status === 401) {
    return 'Your session has expired. Please sign in again.';
  }
  if (status === 403) {
    return 'You do not have permission to do that.';
  }
  if (status === 404) {
    return 'The requested resource was not found.';
  }
  if (status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (status >= 500) {
    return `The server could not complete the request (HTTP ${status}). Please try again in a moment.`;
  }
  return fallback;
}

function readMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    // A whole HTML/XML document is never a message worth showing, and neither is
    // validator text (`capacity must be an integer number`,
    // `String must contain at least 1 character(s)`): it names a DTO property,
    // not something the user can do.
    return isRawDocumentBody(value) || isRawValidationText(value) ? null : value;
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

export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiClientError) {
    const fromDetails = readMessage(error.details);
    if (fromDetails) return fromDetails;
    if (isPlanLimitError(error.details)) {
      return planLimitFallback(error.details) ?? fromDetails ?? error.message;
    }
    if (error.status === 0 || error.status === 401 || error.status === 403) {
      return statusFallbackMessage(error.status, fallback);
    }
    // No envelope message: the body was empty, a raw document (HTML 500 / proxy
    // page), or only developer text. The client's own `error.message` is built
    // as `Request failed with status <n>` plus a slice of the body, so it is a
    // diagnostic — never show it. Fall back to a status-based sentence.
    if (
      isRawDocumentBody(error.details) ||
      error.status >= 500 ||
      isRawValidationText(error.message)
    ) {
      return statusFallbackMessage(error.status, fallback);
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

/**
 * The slice of a Zod error the form helpers need.
 *
 * `ZodError` satisfies this structurally, so callers can pass the error from
 * `safeParse()` directly without importing Zod types here.
 */
export interface ZodIssueLike {
  path: ReadonlyArray<string | number>;
  message: string;
}

export interface ZodErrorLike {
  issues: ReadonlyArray<ZodIssueLike>;
}

/**
 * Maps a Zod error to the `field -> message` keys the forms render.
 *
 * Errors are read from `error.issues` (the full path of every issue) rather
 * than `error.flatten().fieldErrors`, because `flatten()` only reports the
 * **top-level** key of a nested object. For a schema such as
 * `adminSchoolCreateSchema` a bad code arrives as `school.code`, but
 * `flatten()` keys it simply as `school` — looking up `school.code` in that
 * map returns nothing, so the form silently swallowed every validation error
 * and the submit button appeared to do nothing.
 *
 * Paths are joined with dots (`school.code`, `admin.password`), which is
 * exactly how nested forms address their fields; single-segment paths
 * (`code`) behave exactly as before.
 *
 * Each message is then passed through `fieldErrorMessage`, so a form always
 * renders guidance that names the field: Zod's own sentences ("String must
 * contain at least 1 character(s)") are developer text and are rewritten, a
 * message already written for a person ("Password must be at least 8
 * characters") is kept verbatim.
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
      result[key] = fieldErrorMessage(key, issue.message, labels);
    }
  }
  return result;
}

/**
 * Object-level Zod messages that belong to no single field (e.g. `.strict()`
 * reporting an unrecognized key, or a `.refine()` on the whole object).
 *
 * These have an empty path, so `fieldErrorsFromZod()` skips them; forms show
 * them in the form-level error area instead of dropping them.
 */
export function formErrorsFromZod(error: ZodErrorLike): string[] {
  return error.issues.filter((issue) => issue.path.length === 0).map((issue) => issue.message);
}

export function unwrapEnvelope<T>(
  envelope: { success: boolean; data?: T; message?: string; error?: { message: string } },
  fallback = 'Request failed',
): T {
  if (envelope.data !== undefined) {
    return envelope.data;
  }
  throw new Error(envelope.error?.message || envelope.message || fallback);
}

function isPlanLimitError(details: unknown): boolean {
  if (!details || typeof details !== 'object') return false;
  const record = details as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : record;
  return nested.error === 'PLAN_LIMIT_REACHED' || nested.code === 'PLAN_LIMIT_REACHED';
}

function planLimitFallback(details: unknown): string | null {
  return readMessage(details);
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function fieldErrorsFromUnknown(
  error: unknown,
  labels?: FieldLabelMap,
): Record<string, string> {
  return mapApiValidationErrors(error, labels).fieldErrors;
}

/**
 * The sentences of a rejected submission that belong to **no field of this
 * form** — the ones to show in the form-level error area.
 *
 * Without this half, attributing a message to an input would silently swallow
 * it whenever the form does not render that input.
 */
export function formErrorsFromApiError(
  error: unknown,
  labels?: FieldLabelMap,
): string[] {
  return mapApiValidationErrors(error, labels).formErrors;
}

/**
 * The form-level line for a rejected submission: the leftover messages, or the
 * one instruction that says why the highlighted fields matter.
 */
export function submitErrorMessage(error: unknown, labels?: FieldLabelMap): string {
  return formMessageForInvalidSubmission(mapApiValidationErrors(error, labels));
}
