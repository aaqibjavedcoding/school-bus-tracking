import '../support/env';
import { TEST_WEB_ORIGIN } from '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import { createBus, createSchool, createUser, TEST_PASSWORD } from '../support/fixtures';
import { startTestApp, TestApp } from '../support/app';
import { login } from '../support/auth';
import { errorMessage, httpRequest, readCookie } from '../support/http';
import { CSRF_INVALID_MESSAGE } from '../../src/common/security';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
import { School, User } from '../../src/database/models';

const EVIL_ORIGIN = 'http://evil.example.com';

/**
 * Browser-facing security: CORS, CSRF, cookies and response headers, verified
 * over real HTTP against the real application.
 */
describe('browser security (real HTTP)', () => {
  let sequelize: Sequelize;
  let app: TestApp;
  let school: School;
  let admin: User;

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);
    school = await createSchool();
    admin = await createUser(school.id, UserRole.SCHOOL_ADMIN);
    await createBus(school.id);
    app = await startTestApp();
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
  });

  describe('CORS', () => {
    it('echoes an allowlisted origin with credentials enabled', async () => {
      const response = await httpRequest(app.baseUrl, '/health', { origin: TEST_WEB_ORIGIN });
      assert.equal(response.headers.get('access-control-allow-origin'), TEST_WEB_ORIGIN);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      assert.match(String(response.headers.get('vary')), /Origin/i);
    });

    it('never echoes an origin outside the allowlist', async () => {
      const response = await httpRequest(app.baseUrl, '/health', { origin: EVIL_ORIGIN });
      const allowed = response.headers.get('access-control-allow-origin');
      assert.notEqual(allowed, EVIL_ORIGIN);
      assert.notEqual(allowed, '*');
    });

    it('answers the preflight for an allowlisted origin only', async () => {
      const good = await httpRequest(app.baseUrl, '/buses', {
        method: 'OPTIONS',
        origin: TEST_WEB_ORIGIN,
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,authorization',
        },
      });
      assert.ok(good.status === 204 || good.status === 200);
      assert.equal(good.headers.get('access-control-allow-origin'), TEST_WEB_ORIGIN);

      const bad = await httpRequest(app.baseUrl, '/buses', {
        method: 'OPTIONS',
        origin: EVIL_ORIGIN,
        headers: { 'Access-Control-Request-Method': 'POST' },
      });
      assert.notEqual(bad.headers.get('access-control-allow-origin'), EVIL_ORIGIN);
    });

    it('keeps non-browser clients (no Origin header) working', async () => {
      const session = await login(app.baseUrl, school.code, admin.email);
      const response = await httpRequest(app.baseUrl, '/buses', { token: session.accessToken });
      assert.equal(response.status, 200);
    });
  });

  describe('security headers', () => {
    it('sets the hardening headers on every response', async () => {
      const response = await httpRequest(app.baseUrl, '/health');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.match(String(response.headers.get('content-security-policy')), /frame-ancestors/);
      assert.ok(response.headers.get('permissions-policy'));
      assert.equal(response.headers.get('x-powered-by'), null);
    });

    it('does not advertise HSTS over plain HTTP in a non-production environment', async () => {
      const response = await httpRequest(app.baseUrl, '/health');
      assert.equal(response.headers.get('strict-transport-security'), null);
    });

    it('keeps a JSON-only CSP that cannot host active content', async () => {
      const csp = String((await httpRequest(app.baseUrl, '/health')).headers.get(
        'content-security-policy',
      ));
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
    });
  });

  describe('CSRF', () => {
    it('issues a readable CSRF cookie on login and on GET /auth/csrf', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });
      assert.ok(session.csrfCookie, 'login must seed the CSRF cookie');
      assert.ok(
        session.cookies.some(
          (cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`) && !/httponly/i.test(cookie),
        ),
        'the CSRF cookie must be readable by the browser (double submit)',
      );

      const issued = await httpRequest(app.baseUrl, '/auth/csrf', { origin: TEST_WEB_ORIGIN });
      assert.equal(issued.status, 200);
      assert.ok(readCookie(issued.cookies, CSRF_COOKIE_NAME));
    });

    it('rejects a cookie-authenticated mutation without the CSRF header', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });
      const response = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: {
          refresh_token: session.refreshCookie as string,
          [CSRF_COOKIE_NAME]: session.csrfCookie as string,
        },
      });
      assert.equal(response.status, 403);
      assert.equal(errorMessage(response.body), CSRF_INVALID_MESSAGE);
    });

    it('rejects a mismatched CSRF header', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });
      const response = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: {
          refresh_token: session.refreshCookie as string,
          [CSRF_COOKIE_NAME]: session.csrfCookie as string,
        },
        headers: { [CSRF_HEADER_NAME]: 'not-the-token' },
      });
      assert.equal(response.status, 403);
    });

    it('accepts the mutation when the double-submit token matches', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });
      const response = await httpRequest<{ data: { access_token: string } }>(
        app.baseUrl,
        '/auth/refresh',
        {
          method: 'POST',
          origin: TEST_WEB_ORIGIN,
          cookies: {
            refresh_token: session.refreshCookie as string,
            [CSRF_COOKIE_NAME]: session.csrfCookie as string,
          },
          headers: { [CSRF_HEADER_NAME]: session.csrfCookie as string },
        },
      );
      assert.equal(response.status, 200);
      assert.ok(response.body.data.access_token);
    });

    it('rejects a cross-site mutation outright, token or not', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });
      const response = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        origin: EVIL_ORIGIN,
        cookies: {
          refresh_token: session.refreshCookie as string,
          [CSRF_COOKIE_NAME]: session.csrfCookie as string,
        },
        headers: { [CSRF_HEADER_NAME]: session.csrfCookie as string },
      });
      assert.equal(response.status, 403);
    });

    /**
     * Regression: the web app could not log in after the CSRF rollout.
     *
     * A tab that still holds the httpOnly refresh cookie but no readable
     * CSRF cookie (12h TTL elapsed, cookie cleared, session predating the
     * rollout) is a cookie session without a token — correctly refused. The
     * way out is the bootstrap endpoint, which is what the web client now
     * calls before any state-changing auth request.
     */
    it('lets a browser without a CSRF cookie bootstrap one and log in again', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });

      const blocked = await httpRequest(app.baseUrl, '/auth/login', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: { refresh_token: session.refreshCookie as string },
        body: { school_id: school.code, email: admin.email, password: TEST_PASSWORD },
      });
      assert.equal(blocked.status, 403);
      assert.equal(errorMessage(blocked.body), CSRF_INVALID_MESSAGE);

      const bootstrap = await httpRequest<{
        data: { csrf_token: string; header_name: string };
      }>(app.baseUrl, '/auth/csrf', {
        origin: TEST_WEB_ORIGIN,
        cookies: { refresh_token: session.refreshCookie as string },
      });
      const token = readCookie(bootstrap.cookies, CSRF_COOKIE_NAME);
      assert.equal(bootstrap.status, 200);
      assert.ok(token, 'GET /auth/csrf must set the readable cookie');
      assert.equal(bootstrap.body.data.csrf_token, token);
      assert.equal(bootstrap.body.data.header_name, CSRF_HEADER_NAME);

      const allowed = await httpRequest(app.baseUrl, '/auth/login', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: {
          refresh_token: session.refreshCookie as string,
          [CSRF_COOKIE_NAME]: token as string,
        },
        headers: { [CSRF_HEADER_NAME]: token as string },
        body: { school_id: school.code, email: admin.email, password: TEST_PASSWORD },
      });
      assert.equal(allowed.status, 200);
    });

    it('leaves bearer-token clients (mobile) unaffected', async () => {      const session = await login(app.baseUrl, school.code, admin.email);
      const response = await httpRequest(app.baseUrl, '/buses', {
        method: 'POST',
        token: session.accessToken,
        body: { registration_number: `CSRF-${Date.now()}`, capacity: 11 },
      });
      assert.equal(response.status, 201);
    });

    it('does not gate safe methods', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });
      const response = await httpRequest(app.baseUrl, '/buses', {
        token: session.accessToken,
        origin: TEST_WEB_ORIGIN,
        cookies: { refresh_token: session.refreshCookie as string },
      });
      assert.equal(response.status, 200);
    });
  });

  describe('session cookies', () => {
    it('sets an httpOnly, sameSite refresh cookie scoped to the auth path', async () => {
      const result = await httpRequest(app.baseUrl, '/auth/login', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        body: { school_id: school.code, email: admin.email, password: TEST_PASSWORD },
      });
      const cookie = result.cookies.find((entry) => entry.startsWith('refresh_token='));
      assert.ok(cookie, 'refresh cookie must be set');
      assert.match(cookie as string, /HttpOnly/i);
      assert.match(cookie as string, /SameSite=/i);
      assert.match(cookie as string, /Path=\/api\/v1\/auth/i);
    });

    it('rotates the refresh token and clears both cookies on logout', async () => {
      const session = await login(app.baseUrl, school.code, admin.email, {
        origin: TEST_WEB_ORIGIN,
      });

      const refreshed = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: {
          refresh_token: session.refreshCookie as string,
          [CSRF_COOKIE_NAME]: session.csrfCookie as string,
        },
        headers: { [CSRF_HEADER_NAME]: session.csrfCookie as string },
      });
      const rotated = readCookie(refreshed.cookies, 'refresh_token');
      assert.ok(rotated);
      assert.notEqual(rotated, session.refreshCookie);

      // The consumed token must not work a second time.
      const replay = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: {
          refresh_token: session.refreshCookie as string,
          [CSRF_COOKIE_NAME]: session.csrfCookie as string,
        },
        headers: { [CSRF_HEADER_NAME]: session.csrfCookie as string },
      });
      assert.equal(replay.status, 401);

      const newCsrf = readCookie(refreshed.cookies, CSRF_COOKIE_NAME) ?? session.csrfCookie;
      const loggedOut = await httpRequest(app.baseUrl, '/auth/logout', {
        method: 'POST',
        origin: TEST_WEB_ORIGIN,
        cookies: { refresh_token: rotated as string, [CSRF_COOKIE_NAME]: newCsrf as string },
        headers: { [CSRF_HEADER_NAME]: newCsrf as string },
      });
      assert.equal(loggedOut.status, 200);
      assert.ok(
        loggedOut.cookies.some(
          (cookie) => cookie.startsWith('refresh_token=') && /Expires=|Max-Age=0/i.test(cookie),
        ),
        'logout must clear the refresh cookie',
      );
      assert.ok(
        loggedOut.cookies.some(
          (cookie) =>
            cookie.startsWith(`${CSRF_COOKIE_NAME}=`) && /Expires=|Max-Age=0/i.test(cookie),
        ),
        'logout must clear the CSRF cookie',
      );
    });

    it('refuses a refresh token supplied in the body unless explicitly enabled', async () => {
      const session = await login(app.baseUrl, school.code, admin.email);
      const response = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        body: { refresh_token: session.refreshCookie },
      });
      assert.equal(response.status, 401);
    });
  });
});
