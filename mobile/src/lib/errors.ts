import { ApiClientError } from '@school-bus-tracking/api-client';

/**
 * Mobile port of the shared error helpers used by the web app, so both
 * clients surface the exact same API error messages (nested envelope errors,
 * network failures, session expiry) instead of raw fetch errors.
 */

/**
 * True for a response body that is a *document*, not a message (a framework
 * or proxy HTML error page). Mirrors the web helper: such a body must never be
 * rendered verbatim as the error text.
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
    return isRawDocumentBody(value) ? null : value;
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
    if (error.status === 0 || error.status === 401 || error.status === 403) {
      return statusFallbackMessage(error.status, fallback);
    }
    // Empty or raw-document body: never echo markup into the UI.
    if (isRawDocumentBody(error.details) || error.status >= 500) {
      return statusFallbackMessage(error.status, fallback);
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
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
 */
export function fieldErrorsFromZod(error: ZodErrorLike): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      continue;
    }
    const key = issue.path.join('.');
    if (!result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}

/** Object-level Zod messages that belong to no single field. */
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

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Maps server-side field validation errors (the `error.details` map returned
 * by the API on a 422) to the `field -> message` shape the mobile forms
 * render — mirrors the web `fieldErrorsFromUnknown` helper.
 */
export function fieldErrorsFromUnknown(error: unknown): Record<string, string> {
  if (!(error instanceof ApiClientError) || !error.details || typeof error.details !== 'object') {
    return {};
  }
  const details = error.details as Record<string, unknown>;
  const nested =
    details.error && typeof details.error === 'object'
      ? (details.error as Record<string, unknown>)
      : details;
  const raw = nested.details;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const message = readMessage(value);
    if (message) result[key] = message;
  }
  return result;
}
