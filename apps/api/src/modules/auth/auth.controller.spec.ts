import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  CLIENT_SESSION_HEADER,
  CLIENT_SESSION_REFRESH_TOKEN_BODY,
  LoginResponse,
  LogoutResponse,
  RefreshResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LOGOUT_SUCCESS_MESSAGE } from './auth.constants';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function makeMockResponse() {
  const cookies: Record<string, { val: string; options: unknown }> = {};
  const clearedCookies: Record<string, unknown> = {};

  const res = {
    cookie: (name: string, val: string, options: unknown) => {
      cookies[name] = { val, options };
      return res;
    },
    clearCookie: (name: string, options: unknown) => {
      clearedCookies[name] = options;
      return res;
    },
  } as unknown as Response;

  return { res, cookies, clearedCookies };
}

function makeMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    cookies: {},
    headers: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeMockAuthService(): AuthService {
  return {
    getRefreshCookieName: () => 'refresh_token',
    getRefreshCookieOptions: (isHttpsRequest = false) => ({
      httpOnly: true,
      secure: isHttpsRequest,
      sameSite: isHttpsRequest ? ('none' as const) : ('lax' as const),
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    }),
    getClearCookieOptions: (isHttpsRequest = false) => ({
      httpOnly: true,
      secure: isHttpsRequest,
      sameSite: isHttpsRequest ? ('none' as const) : ('lax' as const),
      path: '/api/v1/auth',
    }),
    login: async (_dto: LoginDto) => ({
      response: {
        access_token: 'mock-access-token',
        token_type: 'Bearer' as const,
        expires_in: 900,
        user: {
          id: USER_ID,
          school_id: SCHOOL_ID,
          role: UserRole.DRIVER,
          first_name: 'Dana',
          last_name: 'Driver',
          email: 'driver@school.org',
        },
      },
      refreshToken: 'mock-refresh-token-123',
    }),
    refresh: async (token?: string) => {
      if (!token || token !== 'mock-refresh-token-123') {
        throw new Error('Invalid token in mock');
      }
      return {
        response: {
          access_token: 'new-access-token',
          token_type: 'Bearer' as const,
          expires_in: 900,
          user: {
            id: USER_ID,
            school_id: SCHOOL_ID,
            role: UserRole.DRIVER,
            first_name: 'Dana',
            last_name: 'Driver',
            email: 'driver@school.org',
          },
        },
        refreshToken: 'new-rotated-refresh-token-456',
      };
    },
    logout: async (_token?: string): Promise<LogoutResponse> => ({
      message: LOGOUT_SUCCESS_MESSAGE,
    }),
  } as unknown as AuthService;
}

describe('AuthController', () => {
  it('POST /login returns LoginResponse and sets httpOnly refresh token cookie', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res, cookies } = makeMockResponse();

    const dto = new LoginDto();
    dto.school_id = SCHOOL_ID;
    dto.email = 'driver@school.org';
    dto.password = 'correct-horse-battery';

    const result: LoginResponse = await controller.login(dto, makeMockRequest(), res);

    assert.equal(result.access_token, 'mock-access-token');
    assert.equal(result.token_type, 'Bearer');
    assert.equal(result.expires_in, 900);
    assert.equal(result.user.id, USER_ID);

    // Refresh token cookie was set
    assert.ok(cookies['refresh_token']);
    assert.equal(cookies['refresh_token'].val, 'mock-refresh-token-123');
    assert.deepEqual(cookies['refresh_token'].options, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('sets SameSite=None; Secure when HTTPS is terminated by a trusted proxy', async () => {
    const controller = new AuthController(makeMockAuthService());
    const { res, cookies } = makeMockResponse();
    const dto = Object.assign(new LoginDto(), {
      school_id: SCHOOL_ID,
      email: 'driver@school.org',
      password: 'correct-horse-battery',
    });

    await controller.login(
      dto,
      makeMockRequest({ headers: { 'x-forwarded-proto': 'https' } }),
      res,
    );

    assert.deepEqual(cookies['refresh_token'].options, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('POST /refresh extracts cookie, rotates refresh token cookie, and returns RefreshResponse', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res, cookies } = makeMockResponse();

    const req = makeMockRequest({
      cookies: { refresh_token: 'mock-refresh-token-123' },
    });

    const result: RefreshResponse = await controller.refresh(req, res);

    assert.equal(result.access_token, 'new-access-token');
    assert.equal(result.token_type, 'Bearer');

    // New rotated refresh token cookie was set
    assert.ok(cookies['refresh_token']);
    assert.equal(cookies['refresh_token'].val, 'new-rotated-refresh-token-456');
  });

  it('POST /refresh falls back to parsing raw Cookie header if req.cookies is absent', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res, cookies } = makeMockResponse();

    const req = makeMockRequest({
      headers: { cookie: 'refresh_token=mock-refresh-token-123; other=foo' },
    });

    const result = await controller.refresh(req, res);
    assert.equal(result.access_token, 'new-access-token');
    assert.equal(cookies['refresh_token'].val, 'new-rotated-refresh-token-456');
  });

  it('POST /logout revokes session, clears cookie, and returns LogoutResponse', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res, clearedCookies } = makeMockResponse();

    const req = makeMockRequest({
      cookies: { refresh_token: 'mock-refresh-token-123' },
    });

    const result: LogoutResponse = await controller.logout(req, res);

    assert.equal(result.message, LOGOUT_SUCCESS_MESSAGE);
    assert.ok(clearedCookies['refresh_token']);
    assert.deepEqual(clearedCookies['refresh_token'], {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  });

  it('POST /login never puts the refresh token in the body for browser clients', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res } = makeMockResponse();

    const dto = new LoginDto();
    dto.email = 'driver@school.org';
    dto.password = 'correct-horse-battery';

    const result: LoginResponse = await controller.login(dto, makeMockRequest(), res);
    assert.equal(result.refresh_token, undefined);
  });

  it('POST /login echoes the refresh token in the body for mobile session clients', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res, cookies } = makeMockResponse();

    const dto = new LoginDto();
    dto.email = 'driver@school.org';
    dto.password = 'correct-horse-battery';

    const req = makeMockRequest({
      headers: { [CLIENT_SESSION_HEADER]: CLIENT_SESSION_REFRESH_TOKEN_BODY },
    });

    const result: LoginResponse = await controller.login(dto, req, res);
    assert.equal(result.refresh_token, 'mock-refresh-token-123');
    // The httpOnly cookie is still set for the flow: the body copy is an
    // opt-in addition, not a replacement.
    assert.equal(cookies['refresh_token'].val, 'mock-refresh-token-123');
  });

  it('POST /refresh echoes the rotated refresh token when the client used the body fallback', async () => {
    const authService = makeMockAuthService();
    const controller = new AuthController(authService);
    const { res } = makeMockResponse();

    const req = makeMockRequest({
      headers: { [CLIENT_SESSION_HEADER]: CLIENT_SESSION_REFRESH_TOKEN_BODY },
      body: { refresh_token: 'mock-refresh-token-123' },
    });

    const result = await controller.refresh(req, res);
    assert.equal(result.access_token, 'new-access-token');
    assert.equal(result.refresh_token, 'new-rotated-refresh-token-456');
  });

  it('POST /logout accepts the refresh token from the request body (mobile, no cookies)', async () => {
    let revokedToken: string | undefined;
    const authService = makeMockAuthService();
    (authService as unknown as { logout: (t?: string) => Promise<LogoutResponse> }).logout = async (
      token?: string,
    ) => {
      revokedToken = token;
      return { message: LOGOUT_SUCCESS_MESSAGE };
    };
    const controller = new AuthController(authService);
    const { res } = makeMockResponse();

    const req = makeMockRequest({ body: { refresh_token: 'mobile-refresh-token-789' } });
    const result: LogoutResponse = await controller.logout(req, res);

    assert.equal(result.message, LOGOUT_SUCCESS_MESSAGE);
    assert.equal(revokedToken, 'mobile-refresh-token-789');
  });
});
