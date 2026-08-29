import { ApiClientError } from '@school-bus-tracking/api-client';

/**
 * Mobile port of the shared error helpers used by the web app, so both
 * clients surface the exact same API error messages (nested envelope errors,
 * network failures, session expiry) instead of raw fetch errors.
 */

function readMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
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
    if (error.status === 0) {
      return 'Network error. Check your connection and try again.';
    }
    if (error.status === 401) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error.status === 403) {
      return 'You do not have permission to do that.';
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
