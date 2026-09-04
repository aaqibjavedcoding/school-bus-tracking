/**
 * `Set-Cookie` serialization.
 *
 * Express' `res.cookie(name, value, options)` and `res.clearCookie(name,
 * options)` are replaced by these two functions. The emitted header must be
 * identical to what Express produced, because the refresh-token and CSRF
 * cookies are already deployed and the web/mobile clients depend on their
 * exact attributes (`Path`, `SameSite`, `Secure`, `HttpOnly`, `Max-Age`).
 */
import type { CookieOptions } from 'express';

/**
 * Serializes one cookie the way Express does.
 *
 * Notes on fidelity:
 * - Express URL-encodes the value by default (`encode: encodeURIComponent`).
 * - `maxAge` is milliseconds in Express and seconds in the header, and
 *   Express additionally emits a matching `Expires`.
 * - Attribute order follows Express' own `cookie.serialize`.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const encode = options.encode ?? encodeURIComponent;
  const segments = [`${name}=${encode(value)}`];

  if (options.maxAge !== undefined && options.maxAge !== null) {
    const seconds = Math.floor(options.maxAge / 1000);
    segments.push(`Max-Age=${seconds}`);
    // Express sets both Max-Age and Expires when maxAge is given.
    segments.push(`Expires=${new Date(Date.now() + options.maxAge).toUTCString()}`);
  } else if (options.expires) {
    segments.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.domain) {
    segments.push(`Domain=${options.domain}`);
  }

  segments.push(`Path=${options.path ?? '/'}`);

  if (options.httpOnly) {
    segments.push('HttpOnly');
  }
  if (options.secure) {
    segments.push('Secure');
  }
  if (options.partitioned) {
    segments.push('Partitioned');
  }
  if (options.priority) {
    const priority = options.priority;
    segments.push(`Priority=${priority.charAt(0).toUpperCase()}${priority.slice(1)}`);
  }
  if (options.sameSite) {
    const sameSite =
      options.sameSite === true
        ? 'Strict'
        : String(options.sameSite).charAt(0).toUpperCase() + String(options.sameSite).slice(1);
    segments.push(`SameSite=${sameSite}`);
  }

  return segments.join('; ');
}

/**
 * Serializes the cookie-clearing header.
 *
 * Express' `clearCookie` sets an empty value with `Expires=Thu, 01 Jan 1970`
 * and `Max-Age=0`, keeping the remaining attributes so the browser matches
 * and removes the original cookie.
 */
export function serializeClearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', {
    ...options,
    expires: new Date(0),
    maxAge: undefined,
  }).concat('; Max-Age=0');
}

/** A queued cookie mutation produced by a handler. */
export interface CookieMutation {
  name: string;
  value: string;
  options: CookieOptions;
  clear?: boolean;
}

/**
 * Collects cookie mutations during a request so the route runtime can append
 * them to the outgoing response. This is the object handed to handlers in
 * place of Express' `res`.
 */
export class CookieJar {
  private readonly mutations: CookieMutation[] = [];

  cookie(name: string, value: string, options: CookieOptions = {}): void {
    this.mutations.push({ name, value, options });
  }

  clearCookie(name: string, options: CookieOptions = {}): void {
    this.mutations.push({ name, value: '', options, clear: true });
  }

  /** Appends every queued `Set-Cookie` header onto the outgoing headers. */
  applyTo(headers: Headers): void {
    for (const mutation of this.mutations) {
      headers.append(
        'Set-Cookie',
        mutation.clear
          ? serializeClearCookie(mutation.name, mutation.options)
          : serializeCookie(mutation.name, mutation.value, mutation.options),
      );
    }
  }
}
