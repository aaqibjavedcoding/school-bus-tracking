/**
 * Endpoint definitions for the `auth` module.
 *
 * These four endpoints are the only ones that write cookies, so they are
 * hand-written rather than generated. Every cookie decision — name, options,
 * the HTTPS detection that drives `Secure`/`SameSite`, and the body-token
 * fallback — is carried over unchanged from `AuthController`; only
 * `res.cookie` / `res.clearCookie` are replaced by the {@link CookieJar}.
 */
import type { LoginResponse, LogoutResponse, RefreshResponse } from '@school-bus-tracking/shared-types';
import { HttpStatus } from '../framework';
import { container } from '../container';
import type { EndpointDefinition, HandlerContext } from '../http/route-runtime';
import type { AdaptedRequest } from '../http/request-adapter';
import type { CookieJar } from '../http/cookies';
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
    const { response, refreshToken } = await container().auth().login(body);
    setRefreshTokenCookie(request, cookies, refreshToken);
    issueCsrfToken(request, cookies);
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
    const { response, refreshToken } = await container().auth().refresh(rawRefreshToken);
    setRefreshTokenCookie(request, cookies, refreshToken);
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
    clearCsrfCookie(request, cookies);
    return result satisfies LogoutResponse;
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
