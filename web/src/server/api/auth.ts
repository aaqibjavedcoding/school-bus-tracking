/**
 * Endpoint definitions for the `auth` module.
 *
 * These four endpoints are the only ones that write cookies, so they are
 * hand-written rather than generated. Every cookie decision — name, options,
 * the HTTPS detection that drives `Secure`/`SameSite`, and the body-token
 * fallback — is carried over unchanged from `AuthController`; only
 * `res.cookie` / `res.clearCookie` are replaced by the {@link CookieJar}.
 *
 * Login (success and failure) and logout are audited. Token refresh is
 * deliberately *not*: it fires every few minutes per active user and the
 * session is already bounded by its login/logout events.
 */
import type { LoginResponse, LogoutResponse, RefreshResponse } from '@school-bus-tracking/shared-types';
import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition, HandlerContext } from '../http/route-runtime';
import type { AdaptedRequest } from '../http/request-adapter';
import type { CookieJar } from '../http/cookies';
import type { CookieOptions } from 'express';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { LoginDto } from '../modules/auth/dto/login.dto';
import { parseCookieHeader } from '../auth';
import { buildCsrfClearCookieOptions, buildCsrfCookieOptions, generateCsrfToken } from '../common/security';

/** Payload of `GET /api/v1/auth/csrf`. */
export interface CsrfTokenResponse {
  csrf_token: string;
  header_name: string;
}

/** `req.secure || x-forwarded-proto === https`, as the controller had it. */
function isHttpsRequest(request: AdaptedRequest): boolean {
  if (request.secure) {
    return true;
  }
  const forwardedProto = request.headers['x-forwarded-proto'];
  const first = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(',')[0];
  return first?.trim().toLowerCase() === 'https';
}

function csrfCookieName(): string {
  return container().config().get<string>('security.csrf.cookieName') ?? 'csrf_token';
}

function csrfCookieInput(request: AdaptedRequest) {
  return {
    isProduction: container().config().get<boolean>('security.isProduction') === true,
    isHttpsRequest: isHttpsRequest(request),
    ttlMs: container().config().get<number>('security.csrf.ttlMs') ?? 12 * 60 * 60 * 1000,
  };
}

/** Issues (or rotates) the readable double-submit CSRF cookie. */
function issueCsrfToken(request: AdaptedRequest, cookies: CookieJar): string {
  const token = generateCsrfToken();
  cookies.cookie(csrfCookieName(), token, buildCsrfCookieOptions(csrfCookieInput(request)));
  return token;
}

function clearCsrfCookie(request: AdaptedRequest, cookies: CookieJar): void {
  cookies.clearCookie(
    csrfCookieName(),
    buildCsrfClearCookieOptions(csrfCookieInput(request)),
  );
}

function setRefreshTokenCookie(
  request: AdaptedRequest,
  cookies: CookieJar,
  refreshToken: string,
): void {
  const auth = container().auth();
  cookies.cookie(
    auth.getRefreshCookieName(),
    refreshToken,
    auth.getRefreshCookieOptions(isHttpsRequest(request)),
  );
}

function clearRefreshTokenCookie(request: AdaptedRequest, cookies: CookieJar): void {
  const auth = container().auth();
  cookies.clearCookie(
    auth.getRefreshCookieName(),
    auth.getClearCookieOptions(isHttpsRequest(request)),
  );
}

/**
 * Non-sensitive, non-httpOnly session-presence marker cookie.
 *
 * The refresh token itself is httpOnly (the client can never read it), so a
 * freshly loaded tab cannot tell whether a session *might* exist without
 * attempting `POST /auth/refresh`. On every page load — including `/login`
 * — the AuthProvider used to fire `GET /auth/csrf` + `POST /auth/refresh`
 * just to learn "anonymous", and `refresh` fails with 401 for the vast
 * majority of visitors who never logged in.
 *
 * This marker carries **no secret**: it is a plain `1` set (and cleared)
 * alongside the httpOnly refresh cookie, with the same lifetime, on login
 * and on every successful refresh, and removed on logout. The client uses
 * its presence only to decide whether a refresh attempt is worthwhile; the
 * server-side session/security behaviour is completely unchanged (an absent
 * marker never blocks a real login, and the marker cannot mint sessions).
 *
 * Path is `/` so the value is readable from every page (the refresh cookie
 * is scoped to `/api/v1/auth` and invisible to document.cookie anyway).
 */
export const SESSION_PRESENT_COOKIE_NAME = 'sb_session';

function sessionPresentOptions(request: AdaptedRequest): CookieOptions {
  const auth = container().auth();
  const refreshOptions = auth.getRefreshCookieOptions(isHttpsRequest(request));
  return {
    httpOnly: false,
    secure: refreshOptions.secure,
    // Readable same-origin only; never needs to ride along cross-site.
    sameSite: 'lax',
    path: '/',
    // The marker lives exactly as long as the refresh token it mirrors, so
    // the two cookies can never disagree about session lifetime.
    maxAge: refreshOptions.maxAge,
  };
}

function sessionPresentClearOptions(request: AdaptedRequest): CookieOptions {
  return {
    httpOnly: false,
    secure: sessionPresentOptions(request).secure,
    sameSite: 'lax',
    path: '/',
  };
}

function setSessionPresentCookie(request: AdaptedRequest, cookies: CookieJar): void {
  cookies.cookie(SESSION_PRESENT_COOKIE_NAME, '1', sessionPresentOptions(request));
}

function clearSessionPresentCookie(request: AdaptedRequest, cookies: CookieJar): void {
  cookies.clearCookie(
    SESSION_PRESENT_COOKIE_NAME,
    sessionPresentClearOptions(request),
  );
}

/**
 * Resolves the refresh token: parsed cookies first, then the raw Cookie
 * header, then — only when explicitly enabled — the request body.
 */
function extractRefreshToken(request: AdaptedRequest): string | undefined {
  const cookieName = container().auth().getRefreshCookieName();

  if (request.cookies && request.cookies[cookieName]) {
    return request.cookies[cookieName];
  }

  const rawCookie = request.headers['cookie'];
  if (typeof rawCookie === 'string') {
    const parsed = parseCookieHeader(rawCookie);
    if (parsed[cookieName]) {
      return parsed[cookieName];
    }
  }

  const allowBody =
    container().config().get<boolean>('security.allowRefreshTokenInBody') === true;
  const body = request.body as { refresh_token?: string } | undefined;
  if (allowBody && body && typeof body === 'object' && body.refresh_token) {
    return body.refresh_token;
  }

  return undefined;
}

/** `POST /api/v1/auth/login` */
export const postAuthLogin: EndpointDefinition<LoginDto> = {
  auth: false,
  rateLimit: 'auth_login',
  status: HttpStatus.OK,
  bodyType: LoginDto,
  handler: async ({ body, request, cookies }: HandlerContext<LoginDto>) => {
    let session;
    try {
      session = await container().auth().login(body);
    } catch (error) {
      // Failed logins are audited too: brute-force forensics need the
      // attempted identifier. The actor is unknown by definition; the
      // original error is rethrown unchanged so audit cannot alter the
      // auth outcome.
      await container().audit().log({
        school_id: null,
        actor_user_id: null,
        action: AUDIT_ACTIONS.AUTH_LOGIN,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: null,
        ...auditRequestContext({ request }),
        metadata: { success: false, email: body.email },
      });
      throw error;
    }
    const { response, refreshToken } = session;
    setRefreshTokenCookie(request, cookies, refreshToken);
    setSessionPresentCookie(request, cookies);
    issueCsrfToken(request, cookies);
    await container().audit().log({
      school_id: response.user.school_id,
      actor_user_id: response.user.id,
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: response.user.id,
      ...auditRequestContext({ request }),
      metadata: { success: true },
    });
    return response satisfies LoginResponse;
  },
};

/** `POST /api/v1/auth/refresh` */
export const postAuthRefresh: EndpointDefinition = {
  auth: false,
  rateLimit: 'auth_refresh',
  status: HttpStatus.OK,
  handler: async ({ request, cookies }) => {
    const rawRefreshToken = extractRefreshToken(request);
    let result: { response: RefreshResponse; refreshToken: string };
    try {
      result = await container().auth().refresh(rawRefreshToken);
    } catch (error) {
      // A failed refresh means no usable session: drop the presence marker
      // so later page loads stop paying for refresh attempts until the user
      // logs in again. The httpOnly refresh cookie itself is left untouched —
      // clearing it here would change the error semantics of logout.
      clearSessionPresentCookie(request, cookies);
      throw error;
    }
    const { response, refreshToken } = result;
    setRefreshTokenCookie(request, cookies, refreshToken);
    setSessionPresentCookie(request, cookies);
    issueCsrfToken(request, cookies);
    return response satisfies RefreshResponse;
  },
};

/** `POST /api/v1/auth/logout` */
export const postAuthLogout: EndpointDefinition = {
  auth: false,
  rateLimit: 'auth_logout',
  status: HttpStatus.OK,
  handler: async ({ request, cookies }) => {
    const rawRefreshToken = extractRefreshToken(request);
    const result = await container().auth().logout(rawRefreshToken);
    clearRefreshTokenCookie(request, cookies);
    clearSessionPresentCookie(request, cookies);
    clearCsrfCookie(request, cookies);
    // Only a logout that actually revoked a live session is audited — the
    // revoked identity rides along on the service result (never on the
    // wire). No-op logouts carry no identity and would only flood the trail.
    const { revoked_user_id, revoked_school_id, ...response } = result;
    if (revoked_user_id) {
      await container().audit().log({
        school_id: revoked_school_id ?? null,
        actor_user_id: revoked_user_id,
        action: AUDIT_ACTIONS.AUTH_LOGOUT,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        entity_id: revoked_user_id,
        ...auditRequestContext({ request }),
      });
    }
    return response satisfies LogoutResponse;
  },
};

/** `GET /api/v1/auth/csrf` */
export const getAuthCsrf: EndpointDefinition = {
  auth: false,
  status: HttpStatus.OK,
  handler: ({ request, cookies }) => {
    const token = issueCsrfToken(request, cookies);
    return {
      csrf_token: token,
      header_name:
        container().config().get<string>('security.csrf.headerName') ?? 'x-csrf-token',
    } satisfies CsrfTokenResponse;
  },
};
