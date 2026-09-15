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
import type {
  CrewLoginRequest,
  CrewLoginResponse,
  LoginResponse,
  LogoutResponse,
  RefreshResponse,
} from '@school-bus-tracking/shared-types';
import { BadRequestException, ForbiddenException, HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition, HandlerContext } from '../http/route-runtime';
import type { AdaptedRequest } from '../http/request-adapter';
import type { CookieJar } from '../http/cookies';
import type { CookieOptions } from 'express';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
import { LoginDto } from '../modules/auth/dto/login.dto';
import { CrewLoginDto, narrowCrewLoginDto } from '../modules/auth/dto/crew-login.dto';
import { isCrewRole } from '../modules/auth/crew-auth.service';
import { RefreshTokenRotationConflictException } from '../modules/auth/auth.service';
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

/**
 * `POST /api/v1/auth/crew-login` — PIN or QR login for DRIVER / CONDUCTOR
 * (Mobile-UX Phase 4).
 *
 * Unauthenticated and cookie-writing, so it is hand-written here beside the
 * other three rather than generated: it must set exactly the same refresh
 * cookie, session-presence marker and CSRF cookie `postAuthLogin` sets, because
 * a crew session *is* an ordinary session and the rest of the app (sockets,
 * refresh, logout) cannot tell the difference.
 *
 * ### What is deliberately NOT in the audit trail
 *
 * Neither the PIN nor the pairing token is ever written to `audit_logs`, to a
 * log line, or into an error `details` object. A PIN has 10,000 possible values,
 * so an audit trail that recorded attempted PINs would be a dictionary of the
 * ones real drivers use; and a live pairing token in a log would be a
 * replayable credential. The trail records that an attempt happened, which
 * branch it took, and the identity it claimed — which is everything brute-force
 * forensics needs.
 *
 * ### Failure auditing
 *
 * Failures are audited with the same shape as `postAuthLogin`: the actor is
 * unknown by definition, the attempted identity is recorded because that is the
 * forensic value, and the original error is rethrown unchanged so auditing can
 * never alter the auth outcome.
 */
export const postAuthCrewLogin: EndpointDefinition<CrewLoginDto> = {
  auth: false,
  rateLimit: 'auth_crew_login',
  status: HttpStatus.OK,
  bodyType: CrewLoginDto,
  handler: async ({ body, request, cookies }: HandlerContext<CrewLoginDto>) => {
    // The DTO is the coarse gate; `narrowCrewLoginDto` maps it onto the shared
    // discriminated union and is the compile-time link that stops the two from
    // drifting. A body whose fields do not match its declared `method` — including
    // one carrying the other branch's fields, which class-validator's
    // `@ValidateIf` cannot forbid — is rejected here, and `CrewAuthService`
    // re-parses with the `.strict()` shared schema as the authoritative gate.
    const crewBody: CrewLoginRequest | null = narrowCrewLoginDto(body);
    if (!crewBody) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        // Names the declared method and nothing else. The message must not echo
        // any submitted field back, because on the PIN branch one of those
        // fields is the PIN.
        message: `body does not match method "${body.method}"`,
        error: 'Bad Request',
      });
    }

    // Audited identity: what the attempt *claimed*. Never a credential.
    const attempted =
      crewBody.method === 'pin'
        ? { method: 'pin' as const, school_id: crewBody.school_id, user_id: crewBody.user_id }
        : { method: 'qr' as const };

    let session;
    try {
      session = await container().crewAuth().login(crewBody);
    } catch (error) {
      await container().audit().log({
        school_id: null,
        actor_user_id: null,
        action: AUDIT_ACTIONS.AUTH_CREW_LOGIN,
        entity_type: AUDIT_ENTITY_TYPES.USER,
        // `user_id` on the PIN branch is a client claim, not a verified
        // identity, so it goes in the metadata and never in `entity_id` — an
        // auditor must not read a failed attempt as an action by that user.
        entity_id: null,
        ...auditRequestContext({ request }),
        metadata: { success: false, ...attempted },
      });
      throw error;
    }

    const { response, refreshToken } = session;

    // Defence in depth on top of the service's own role gate: this endpoint must
    // never be able to mint a session for a non-crew account, whatever a future
    // refactor of the service does. Checked before any cookie is written, so a
    // rejected login leaves no session state behind.
    if (!isCrewRole(response.user.role)) {
      throw new ForbiddenException('Crew login is only available to drivers and conductors');
    }

    setRefreshTokenCookie(request, cookies, refreshToken);
    setSessionPresentCookie(request, cookies);
    issueCsrfToken(request, cookies);
    await container().audit().log({
      school_id: response.user.school_id,
      actor_user_id: response.user.id,
      action: AUDIT_ACTIONS.AUTH_CREW_LOGIN,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: response.user.id,
      ...auditRequestContext({ request }),
      metadata: { success: true, ...attempted },
    });
    return response satisfies CrewLoginResponse;
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
      //
      // Exception — a rotation conflict: the presented token was superseded
      // by a *concurrent* refresh (another tab, a doubled boot request) and
      // the rotated session is still live. Dropping the marker in that case
      // would log the user out of every tab on the next reload even though a
      // valid session exists, so the marker survives this response. The
      // 401 itself is rethrown unchanged — a stale token is never accepted.
      if (!(error instanceof RefreshTokenRotationConflictException)) {
        clearSessionPresentCookie(request, cookies);
      }
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
