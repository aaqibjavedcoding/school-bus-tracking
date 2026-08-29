import { ApiClientError } from '@school-bus-tracking/api-client';

/**
 * Mobile error presentation helpers.
 *
 * Mirrors the web app's mapping (the API envelope already carries the
 * server-authored message) but never reinterprets authorization: a 401/403
 * is surfaced as-is and the session layer decides what it means.
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

/** True when the failure is a connectivity problem (fetch threw, status 0). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 0;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403;
}

/**
 * The login form's message source: the API's own wording first (it authors
 * “Invalid email, password or school code.” / “This school is inactive.”),
 * generic translations only as a fallback. Mid-session 401s keep using
 * `getApiErrorMessage`, where “your session expired” IS the right story.
 */
export function getSignInErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    const fromDetails = readMessage(error.details);
    if (fromDetails) return fromDetails;
    if (error.message && !/^(unauthorized|forbidden)$/i.test(error.message.trim())) {
      return error.message;
    }
  }
  return fallback;
}

/** 409 = the backend refused a state change (duplicate/illegal transition). */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409;
}

/** 404 — the API's generic "does not exist for you" signal. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

export function apiErrorStatus(error: unknown): number | null {
  return error instanceof ApiClientError ? error.status : null;
}

export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiClientError) {
    if (isNetworkError(error)) {
      return 'Network error. You appear to be offline — nothing was sent.';
    }
    const fromDetails = readMessage(error.details);
    if (fromDetails) return fromDetails;
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
