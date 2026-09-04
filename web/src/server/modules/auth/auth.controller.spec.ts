import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  LoginResponse,
  LogoutResponse,
  RefreshResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LOGOUT_SUCCESS_MESSAGE } from './auth.constants';
import { CookieJar } from '../../http/cookies';
import { callHandler } from '../../http/route-testing';
import { overrideContainer } from '../../container';
import {
  getAuthCsrf,
  postAuthLogin,
  postAuthLogout,
  postAuthRefresh,
  type CsrfTokenResponse,
} from '../../api/auth';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Reads the cookies a handler queued.
 *
 * The controller used to be handed an Express `res` and call
 * `res.cookie(...)` / `res.clearCookie(...)`; handlers now write into a
 * {@link CookieJar}, so the assertions below inspect that instead. Both
 * record the same three things — name, value and options.
 */
function readJar(jar: CookieJar) {
  const cookies: Record<string, { val: string; options: unknown }> = {};
  const clearedCookies: Record<string, unknown> = {};
  for (const mutation of jar.list()) {
    if (mutation.clear) {
      clearedCookies[mutation.name] = mutation.options;
    } else {
      cookies[mutation.name] = { val: mutation.value, options: mutation.options };
    }
  }
  return { cookies, clearedCookies };
}

function makeMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    cookies: {},
    headers: {},
    body: {},
    ...overrides,
  };
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
    login: async () => ({
      response: {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 900,
        user: {
          id: USER_ID,
          school_id: SCHOOL_ID,
          role: UserRole.DRIVER,
          first_name: 'Dana',
          last_name: 'Driver',
          email: 'driver@school.org',
        },
      } as LoginResponse,
      refreshToken: 'mock-refresh-token-123',
    }),
    refresh: async () => ({
      response: {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 900,
      } as RefreshResponse,
      refreshToken: 'new-rotated-refresh-token-456',
    }),
    logout: async (_token?: string): Promise<LogoutResponse> => ({
      message: LOGOUT_SUCCESS_MESSAGE,
    }),
  } as unknown as AuthService;
}

/**
 * The CSRF cookie options come from `ConfigService`, which the container
 * builds from the environment. The values pinned here are the defaults the
 * old controller relied on.
 */
function makeMockConfig() {
  const values: Record<string, unknown> = {
    'security.csrf.cookieName': 'csrf_token',
    'security.csrf.headerName': 'x-csrf-token',
    'security.csrf.ttlMs': 12 * 60 * 60 * 1000,
    'security.isProduction': false,
    'security.allowRefreshTokenInBody': false,
  };
  return { get: (key: string) => values[key] } as never;
}

/** Installs the auth + config doubles for one test. */
function withAuth(service: AuthService = makeMockAuthService()): () => void {
  const undoAuth = overrideContainer('auth', service);
  const undoConfig = overrideContainer('config', makeMockConfig());
  return () => {
    undoConfig();
    undoAuth();
  };
}

describe('auth endpoints', () => {
  it('POST /login returns LoginResponse and sets httpOnly refresh token cookie', async () => {
    const jar = new CookieJar();
    const restore = withAuth();
    let result: LoginResponse;
    try {
      const dto = new LoginDto();
      dto.school_id = SCHOOL_ID;
      dto.email = 'driver@school.org';
      dto.password = 'correct-horse-battery';

      result = (await callHandler(postAuthLogin, {
        body: dto,
        request: makeMockRequest(),
        cookies: jar,
      })) as LoginResponse;
    } finally {
      restore();
    }

    assert.equal(result.access_token, 'mock-access-token');
    assert.equal(result.token_type, 'Bearer');
    assert.equal(result.expires_in, 900);
    assert.equal(result.user.id, USER_ID);

    // Refresh token cookie was set
    const { cookies } = readJar(jar);
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
    const jar = new CookieJar();
    const restore = withAuth();
    try {
      const dto = Object.assign(new LoginDto(), {
        school_id: SCHOOL_ID,
        email: 'driver@school.org',
        password: 'correct-horse-battery',
      });

      await callHandler(postAuthLogin, {
        body: dto,
        request: makeMockRequest({ headers: { 'x-forwarded-proto': 'https' } }),
        cookies: jar,
      });
    } finally {
      restore();
    }

    const { cookies } = readJar(jar);
    assert.deepEqual(cookies['refresh_token'].options, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('POST /refresh extracts cookie, rotates refresh token cookie, and returns RefreshResponse', async () => {
    const jar = new CookieJar();
    const restore = withAuth();
    let result: RefreshResponse;
    try {
      result = (await callHandler(postAuthRefresh, {
        request: makeMockRequest({ cookies: { refresh_token: 'mock-refresh-token-123' } }),
        cookies: jar,
      })) as RefreshResponse;
    } finally {
      restore();
    }

    assert.equal(result.access_token, 'new-access-token');
    assert.equal(result.token_type, 'Bearer');

    // New rotated refresh token cookie was set
    const { cookies } = readJar(jar);
    assert.ok(cookies['refresh_token']);
    assert.equal(cookies['refresh_token'].val, 'new-rotated-refresh-token-456');
  });

  it('POST /refresh falls back to parsing raw Cookie header if req.cookies is absent', async () => {
    const jar = new CookieJar();
    const restore = withAuth();
    let result: RefreshResponse;
    try {
      result = (await callHandler(postAuthRefresh, {
        request: makeMockRequest({
          cookies: undefined,
          headers: { cookie: 'refresh_token=mock-refresh-token-123; other=foo' },
        }),
        cookies: jar,
      })) as RefreshResponse;
    } finally {
      restore();
    }

    assert.equal(result.access_token, 'new-access-token');
    const { cookies } = readJar(jar);
    assert.equal(cookies['refresh_token'].val, 'new-rotated-refresh-token-456');
  });

  it('POST /logout revokes session, clears cookie, and returns LogoutResponse', async () => {
    const jar = new CookieJar();
    const restore = withAuth();
    let result: LogoutResponse;
    try {
      result = (await callHandler(postAuthLogout, {
        request: makeMockRequest({ cookies: { refresh_token: 'mock-refresh-token-123' } }),
        cookies: jar,
      })) as LogoutResponse;
    } finally {
      restore();
    }

    assert.equal(result.message, LOGOUT_SUCCESS_MESSAGE);
    const { clearedCookies } = readJar(jar);
    assert.ok(clearedCookies['refresh_token']);
    assert.deepEqual(clearedCookies['refresh_token'], {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  });

  /**
   * Double-submit CSRF cookie. The browser must be able to read this one
   * back out (it is echoed in `X-CSRF-Token`), which is exactly why it is the
   * only auth cookie that is *not* httpOnly.
   */
  describe('CSRF token cookie', () => {
    it('seeds a readable CSRF cookie on login', async () => {
      const jar = new CookieJar();
      const restore = withAuth();
      try {
        const dto = Object.assign(new LoginDto(), {
          school_id: SCHOOL_ID,
          email: 'driver@school.org',
          password: 'correct-horse-battery',
        });

        await callHandler(postAuthLogin, {
          body: dto,
          request: makeMockRequest(),
          cookies: jar,
        });
      } finally {
        restore();
      }

      const { cookies } = readJar(jar);
      assert.ok(cookies['csrf_token'], 'login must issue the CSRF cookie');
      assert.match(cookies['csrf_token'].val, /^[0-9a-f]{64}$/);
      assert.equal((cookies['csrf_token'].options as { httpOnly: boolean }).httpOnly, false);
    });

    it('GET /csrf bootstraps a token for a browser that has none', async () => {
      const jar = new CookieJar();
      const restore = withAuth();
      let payload: CsrfTokenResponse;
      try {
        payload = (await callHandler(getAuthCsrf, {
          request: makeMockRequest(),
          cookies: jar,
        })) as CsrfTokenResponse;
      } finally {
        restore();
      }

      const { cookies } = readJar(jar);
      assert.match(payload.csrf_token, /^[0-9a-f]{64}$/);
      assert.equal(payload.header_name, 'x-csrf-token');
      assert.equal(
        cookies['csrf_token'].val,
        payload.csrf_token,
        'the cookie and the body must carry the same token (double submit)',
      );
    });

    it('rotates the token on refresh and clears it on logout', async () => {
      const jar = new CookieJar();
      const restore = withAuth();
      try {
        const request = makeMockRequest({ cookies: { refresh_token: 'mock-refresh-token-123' } });

        await callHandler(postAuthRefresh, { request, cookies: jar });
        const afterRefresh = readJar(jar).cookies['csrf_token'].val;
        assert.match(afterRefresh, /^[0-9a-f]{64}$/);

        await callHandler(postAuthLogout, { request, cookies: jar });
      } finally {
        restore();
      }

      const { clearedCookies } = readJar(jar);
      assert.ok(clearedCookies['csrf_token'], 'logout must clear the CSRF cookie too');
      assert.deepEqual(clearedCookies['csrf_token'], {
        httpOnly: false,
        secure: false,
        sameSite: 'lax',
        path: '/',
      });
    });
  });
});
