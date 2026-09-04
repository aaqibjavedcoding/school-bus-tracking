/**
 * Adapters between the Web `Request`/`Response` objects Next's App Router
 * uses and the Express-shaped request/response the existing guards,
 * middleware and cookie helpers were written against.
 *
 * Keeping the adapters (rather than rewriting the guards) is deliberate: the
 * CSRF, rate-limit, JWT and roles guards carry the security rules of the
 * product and are covered by their own specs. They stay byte-for-byte the
 * same; only the object they read is synthesized here.
 */
import type { AuthenticatedRequestUser } from '../common/guards';
import { parseCookieHeader } from '../auth';

/** The Express-ish request surface the guards actually touch. */
export interface AdaptedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  ip: string | undefined;
  secure: boolean;
  socket: { remoteAddress?: string };
  user?: AuthenticatedRequestUser;
  [key: string]: unknown;
}

/**
 * Collects a Web `Headers` object into the lowercase-keyed plain object
 * Express exposes. `set-cookie` is the only header that may legitimately
 * repeat, and it is never read on the request side.
 */
function collectHeaders(headers: Headers): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * Determines the client IP the rate limiter keys on.
 *
 * `resolveClientIp` already implements the trust-proxy rule; this only has to
 * supply the same two inputs Express did: the socket address and the raw
 * `x-forwarded-for` header. Next does not expose the socket, so the first
 * forwarded hop (or the Next-provided `x-real-ip`) stands in for it.
 */
function resolveRequestIp(headers: Record<string, string | string[] | undefined>): string | undefined {
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  const forwarded = headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.trim().length > 0) {
    return first.split(',')[0]!.trim();
  }
  return undefined;
}

/** True when the original client request arrived over HTTPS. */
export function isRequestSecure(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const proto = headers['x-forwarded-proto'];
  const first = Array.isArray(proto) ? proto[0] : proto?.split(',')[0];
  return first?.trim().toLowerCase() === 'https';
}

/**
 * Builds the Express-shaped request the guards consume.
 *
 * `body` is passed in already-parsed because a Web `Request` body can only be
 * consumed once — the route runtime reads it and shares it with both the
 * rate limiter (which keys login attempts on the submitted identity) and the
 * handler.
 */
export function adaptRequest(options: {
  request: Request;
  params?: Record<string, string>;
  body?: unknown;
}): AdaptedRequest {
  const { request, params = {}, body } = options;
  const headers = collectHeaders(request.headers);
  const url = new URL(request.url);

  const cookieHeader = headers['cookie'];
  const cookies =
    typeof cookieHeader === 'string' && cookieHeader.length > 0
      ? parseCookieHeader(cookieHeader)
      : {};

  const query: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      // Repeated query keys collapse to an array, matching Express' default
      // `extended` query parser, which several list DTOs rely on.
      query[key] = [existing, value];
    }
  }

  const ip = resolveRequestIp(headers);

  return {
    method: request.method,
    url: url.pathname + url.search,
    path: url.pathname,
    headers,
    cookies,
    params,
    query,
    body,
    ip,
    secure: isRequestSecure(headers),
    socket: { remoteAddress: ip },
  };
}

/**
 * Minimal Express-shaped response that only records what the guards set.
 *
 * The rate-limit guard writes `RateLimit-*` and `Retry-After` headers through
 * `setHeader`; those are collected here and copied onto the real `Response`
 * (including onto the error response when the limiter rejects the request,
 * which is what makes `Retry-After` observable on a 429).
 */
export class AdaptedResponse {
  readonly headers = new Headers();
  statusCode = 200;

  setHeader(name: string, value: string | number | readonly string[]): void {
    if (Array.isArray(value)) {
      for (const entry of value) {
        this.headers.append(name, String(entry));
      }
      return;
    }
    this.headers.set(name, String(value));
  }

  getHeader(name: string): string | null {
    return this.headers.get(name);
  }

  /** Copies every recorded header onto an outgoing `Headers` instance. */
  applyTo(target: Headers): void {
    this.headers.forEach((value, key) => {
      target.set(key, value);
    });
  }
}
