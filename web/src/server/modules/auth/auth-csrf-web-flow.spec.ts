import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ValidationPipe } from '../../framework';
import type { INestApplication } from '../../framework';
import type { AddressInfo } from 'net';
import * as cookieParser from 'cookie-parser';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ApiClient } from '@school-bus-tracking/api-client';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LOGOUT_SUCCESS_MESSAGE } from './auth.constants';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { CSRF_INVALID_MESSAGE, CsrfGuard } from '../../common/security';
import securityConfig from '../../config/security.config';

/**
 * Web ⇄ API CSRF integration, without a database.
 *
 * Boots the *real* `AuthController` behind the *real* global `CsrfGuard`
 * (only the persistence layer is stubbed) and drives it with the *real*
 * `@school-bus-tracking/api-client` running against a simulated browser:
 * a cookie jar that honours `HttpOnly`, plus the `Origin` header a browser
 * always sends on state-changing same-origin requests.
 *
 * It pins both halves of the regression reported after the CSRF rollout:
 *
 * 1. a browser holding the `refresh_token` cookie but no `csrf_token` cookie
 *    gets `403 Invalid or missing CSRF token` on `POST /auth/login` — the
 *    server behaviour that must **not** change; and
 * 2. the shipped client no longer produces that request: it acquires the
 *    token from `GET /auth/csrf` first and echoes it in `X-CSRF-Token`.
 */

const WEB_ORIGIN = 'http://localhost:3000';
/** The platform `fetch`, captured before the browser simulation replaces it. */
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);
const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const authUser = {
  id: USER_ID,
  school_id: SCHOOL_ID,
  role: UserRole.SCHOOL_ADMIN,
  first_name: 'Ada',
  last_name: 'Admin',
  email: 'admin@school.test',
};

function makeMockAuthService(): AuthService {
  let issued = 0;
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
    login: async () => {
      issued += 1;
      return {
        response: {
          access_token: 'access-token',
          token_type: 'Bearer' as const,
          expires_in: 900,
          user: authUser,
        },
        refreshToken: `refresh-token-${issued}`,
      };
    },
    refresh: async (token?: string) => {
      if (!token) {
        throw new Error('missing refresh token');
      }
      issued += 1;
      return {
        response: {
          access_token: 'rotated-access-token',
          token_type: 'Bearer' as const,
          expires_in: 900,
          user: authUser,
        },
        refreshToken: `refresh-token-${issued}`,
      };
    },
    logout: async () => ({ message: LOGOUT_SUCCESS_MESSAGE }),
  } as unknown as AuthService;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [securityConfig] })],
  controllers: [AuthController],
  providers: [
    { provide: AuthService, useValue: makeMockAuthService() },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
class AuthCsrfTestModule {}

interface JarCookie {
  value: string;
  httpOnly: boolean;
}

/** Cookie jar + `fetch` wrapper that behaves like a browser on `WEB_ORIGIN`. */
class BrowserSession {
  public readonly requests: Array<{ method: string; path: string; csrfHeader: string | null }> = [];
  /**
   * When set, the CSRF cookie is rotated *after* page scripts read it and
   * *before* the request leaves — the double-submit race a concurrent
   * refresh in another tab produces.
   */
  public rotateCsrfBeforeNextUnsafeRequest = false;
  private readonly jar = new Map<string, JarCookie>();

  constructor(private readonly baseUrl: string) {}

  /** Only non-httpOnly cookies are visible to page scripts. */
  get documentCookie(): string {
    return [...this.jar.entries()]
      .filter(([, cookie]) => !cookie.httpOnly)
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join('; ');
  }

  set(name: string, value: string, httpOnly: boolean): void {
    this.jar.set(name, { value, httpOnly });
  }

  get(name: string): string | undefined {
    return this.jar.get(name)?.value;
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  cookieHeader(): string {
    return [...this.jar.entries()].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
  }

  /** Performs the request the way a browser would, then stores `Set-Cookie`. */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set('Origin', WEB_ORIGIN);
    const method = (init.method || 'GET').toUpperCase();
    if (this.rotateCsrfBeforeNextUnsafeRequest && method !== 'GET') {
      this.rotateCsrfBeforeNextUnsafeRequest = false;
      this.set('csrf_token', 'rotated-in-another-tab', false);
    }
    const cookies = this.cookieHeader();
    if (cookies) {
      headers.set('Cookie', cookies);
    }

    this.requests.push({
      method,
      path,
      csrfHeader: headers.get('x-csrf-token'),
    });

    const response = await realFetch(`${this.baseUrl}${path}`, { ...init, headers });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      this.applySetCookie(raw);
    }
    return response;
  }
  private applySetCookie(raw: string): void {
    const [pair, ...attributes] = raw.split(';');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    const httpOnly = attributes.some((attribute) => attribute.trim().toLowerCase() === 'httponly');
    const expired = attributes.some((attribute) =>
      /^max-age=0$|^expires=thu, 01 jan 1970/i.test(attribute.trim()),
    );
    if (expired || value === '') {
      this.jar.delete(name);
      return;
    }
    this.jar.set(name, { value, httpOnly });
  }
}

/**
 * Installs the browser simulation as the global `fetch` + `document` the API
 * client reads, so the client under test is byte-for-byte the shipped one.
 */
function installBrowser(session: BrowserSession, baseUrl: string): () => void {
  const globalScope = globalThis as {
    fetch: typeof fetch;
    document?: { cookie: string };
  };
  const originalFetch = globalScope.fetch;
  const originalDocument = globalScope.document;

  globalScope.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;
    return session.fetch(path, init ?? {});
  }) as typeof fetch;

  Object.defineProperty(globalScope, 'document', {
    configurable: true,
    get: () => ({ cookie: session.documentCookie }),
  });

  return () => {
    globalScope.fetch = originalFetch;
    delete globalScope.document;
    if (originalDocument) {
      globalScope.document = originalDocument;
    }
  };
}

describe('web CSRF flow against the real auth controller and guard', () => {
  let app: INestApplication;
  let origin: string;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.CORS_ORIGIN = WEB_ORIGIN;

    app = await NestFactory.create(AuthCsrfTestModule, { logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    baseUrl = `${origin}/api/v1`;
  });

  after(async () => {
    await app?.close();
  });

  it('reproduces the reported 403: session cookie, no CSRF token', async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: WEB_ORIGIN,
        // Exactly what the browser sent in the bug report: the refresh
        // cookie is there, `X-CSRF-Token` is not.
        Cookie: 'refresh_token=stale-refresh-token',
      },
      body: JSON.stringify({
        school_id: 'triumph-academy',
        email: 'admin@school.test',
        password: 'correct-horse-battery',
      }),
    });
    const body = (await response.json()) as { error?: { code?: string; message?: string } };

    assert.equal(response.status, 403);
    assert.equal(body.error?.message, CSRF_INVALID_MESSAGE);
  });

  it('lets the API client log in from that same stale-cookie browser', async () => {
    const session = new BrowserSession(baseUrl);
    session.set('refresh_token', 'stale-refresh-token', true);
    const restore = installBrowser(session, baseUrl);

    try {
      const client = new ApiClient({ baseUrl });
      const envelope = await client.login({
        school_id: 'triumph-academy',
        email: 'admin@school.test',
        password: 'correct-horse-battery',
      });

      assert.equal(envelope.success, true);
      assert.equal(envelope.data?.access_token, 'access-token');
    } finally {
      restore();
    }

    assert.deepEqual(
      session.requests.map((entry) => `${entry.method} ${entry.path}`),
      ['GET /auth/csrf', 'POST /auth/login'],
      'the client must acquire a CSRF token before the login POST',
    );
    assert.ok(session.requests[1].csrfHeader, 'login must carry the X-CSRF-Token header');
  });

  it('keeps the refresh cookie httpOnly and the CSRF cookie readable', async () => {
    const session = new BrowserSession(baseUrl);
    const restore = installBrowser(session, baseUrl);

    try {
      const client = new ApiClient({ baseUrl });
      await client.login({
        school_id: 'triumph-academy',
        email: 'admin@school.test',
        password: 'correct-horse-battery',
      });
    } finally {
      restore();
    }

    assert.ok(session.has('refresh_token'));
    assert.ok(session.has('csrf_token'));
    assert.ok(
      !session.documentCookie.includes('refresh_token'),
      'the refresh cookie must stay invisible to page scripts',
    );
    assert.match(session.documentCookie, /csrf_token=/);
  });

  it('carries the token through refresh and logout', async () => {
    const session = new BrowserSession(baseUrl);
    const restore = installBrowser(session, baseUrl);

    try {
      const client = new ApiClient({ baseUrl });
      await client.login({
        school_id: 'triumph-academy',
        email: 'admin@school.test',
        password: 'correct-horse-battery',
      });

      const refreshed = await client.refresh();
      assert.equal(refreshed.data?.access_token, 'rotated-access-token');

      const loggedOut = await client.logout();
      assert.equal(loggedOut.data?.message, LOGOUT_SUCCESS_MESSAGE);
    } finally {
      restore();
    }

    const unsafe = session.requests.filter((entry) => entry.method === 'POST');
    for (const request of unsafe) {
      assert.ok(request.csrfHeader, `${request.path} must carry the CSRF header`);
    }
    // Logout clears both cookies; the next login bootstraps a new token.
    assert.equal(session.has('csrf_token'), false);
    assert.equal(session.has('refresh_token'), false);
  });

  it('repairs and replays a request whose token was rotated behind its back', async () => {
    const session = new BrowserSession(baseUrl);
    const restore = installBrowser(session, baseUrl);

    try {
      const client = new ApiClient({ baseUrl });
      await client.login({
        school_id: 'triumph-academy',
        email: 'admin@school.test',
        password: 'correct-horse-battery',
      });

      // The cookie the page read is replaced before the request is sent, so
      // the double-submit values no longer match and the API refuses it.
      session.rotateCsrfBeforeNextUnsafeRequest = true;
      const refreshed = await client.refresh();
      assert.equal(refreshed.success, true, 'the user must not see the 403');
    } finally {
      restore();
    }

    const paths = session.requests.map((entry) => `${entry.method} ${entry.path}`);
    assert.deepEqual(paths.slice(-3), [
      'POST /auth/refresh',
      'GET /auth/csrf',
      'POST /auth/refresh',
    ]);
  });

  it('leaves the mobile (bearer, no Origin) flow untouched', async () => {
    // No browser globals at all: React Native has no `document` and sends no
    // `Origin`, so the API exempts it and the client adds no CSRF header.
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        school_id: 'triumph-academy',
        email: 'admin@school.test',
        password: 'correct-horse-battery',
      }),
    });
    assert.equal(loginResponse.status, 200);

    const refreshCookie = (loginResponse.headers.getSetCookie?.() ?? [])
      .find((cookie) => cookie.startsWith('refresh_token='))
      ?.split(';')[0];
    assert.ok(refreshCookie);

    // The native cookie jar replays the session cookie; still no Origin, so
    // no CSRF token is required of it.
    const refreshResponse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: refreshCookie as string },
    });
    assert.equal(refreshResponse.status, 200);
  });

  it('still refuses a cross-site request that carries a token', async () => {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        Origin: 'http://evil.example.com',
        Cookie: 'refresh_token=stale-refresh-token; csrf_token=abc',
        'X-CSRF-Token': 'abc',
      },
    });
    assert.equal(response.status, 403);
  });
});
