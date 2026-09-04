import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import { createFullSchool, createUser, SchoolFixture, TEST_PASSWORD } from '../support/fixtures';
import { startTestApp, TestApp } from '../support/app';
import { login } from '../support/auth';
import { errorCode, httpRequest } from '../support/http';

/**
 * Rate limiting / brute-force protection over real HTTP.
 *
 * The suite boots its own application with deliberately tiny limits (set from
 * the environment before the app is created — exactly the tuning path an
 * operator uses) and then drives real requests through the guard.
 */
describe('rate limiting (real HTTP)', () => {
  let sequelize: Sequelize;
  let app: TestApp;
  let fixture: SchoolFixture;

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);
    fixture = await createFullSchool(sequelize);

    // Tight, test-only limits. Proven configurable by the fact the suite works.
    process.env.RATE_LIMIT_AUTH_LOGIN_LIMIT = '3';
    process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS = '2000';
    process.env.RATE_LIMIT_LOGIN_IDENTITY_LIMIT = '2';
    process.env.RATE_LIMIT_LOGIN_IDENTITY_WINDOW_MS = '2000';
    process.env.RATE_LIMIT_AUTH_LOGOUT_LIMIT = '2';
    process.env.RATE_LIMIT_AUTH_LOGOUT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_SOS_CREATE_LIMIT = '2';
    process.env.RATE_LIMIT_SOS_CREATE_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_ATTENDANCE_WRITE_LIMIT = '3';
    process.env.RATE_LIMIT_ATTENDANCE_WRITE_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_LOCATION_READ_LIMIT = '3';
    process.env.RATE_LIMIT_LOCATION_READ_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_READ_HEAVY_LIMIT = '5';
    process.env.RATE_LIMIT_READ_HEAVY_WINDOW_MS = '60000';

    app = await startTestApp();
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
    delete process.env.RATE_LIMIT_AUTH_LOGIN_LIMIT;
    delete process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS;
  });

  /**
   * The login policy itself is tiny in this suite, so obtaining a session for
   * the *other* policies retries across the 2s window instead of fighting it.
   */
  async function loginWithBackoff(email: string | null) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await login(app.baseUrl, fixture.school.code, email);
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 2200));
      }
    }
    throw lastError;
  }

  async function attemptLogin(email: string | null, password: string) {
    return httpRequest(app.baseUrl, '/auth/login', {
      method: 'POST',
      body: { school_id: fixture.school.code, email, password },
    });
  }

  it('throttles repeated login attempts and returns a useful 429', async () => {
    const email = (await createUser(fixture.school.id, UserRole.SCHOOL_ADMIN)).email;

    const first = await attemptLogin(email, 'wrong-password');
    assert.equal(first.status, 401);
    assert.ok(first.headers.get('ratelimit-limit'), 'informational headers on allowed requests');

    let throttled: Awaited<ReturnType<typeof attemptLogin>> | null = null;
    for (let attempt = 0; attempt < 8 && !throttled; attempt += 1) {
      const response = await attemptLogin(email, 'wrong-password');
      if (response.status === 429) {
        throttled = response;
      }
    }

    assert.ok(throttled, 'repeated bad credentials must eventually be throttled');
    assert.equal(errorCode(throttled!.body), 'RATE_LIMIT_EXCEEDED');
    const retryAfter = Number(throttled!.headers.get('retry-after'));
    assert.ok(Number.isFinite(retryAfter) && retryAfter > 0, 'Retry-After must be actionable');
    assert.match(
      String((throttled!.body as { error: { message: string } }).error.message),
      /try again/i,
    );
    assert.equal(
      throttled!.headers.get('ratelimit-remaining'),
      '0',
      'the response advertises the exhausted budget',
    );
  });

  it('recovers automatically after the window — never a permanent lockout', async () => {
    const user = await createUser(fixture.school.id, UserRole.SCHOOL_ADMIN);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await attemptLogin(user.email, 'wrong-password');
    }
    const blocked = await attemptLogin(user.email, TEST_PASSWORD);
    assert.equal(blocked.status, 429);

    // The window is 2s in this suite; the account unlocks by itself.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const recovered = await attemptLogin(user.email, TEST_PASSWORD);
    assert.equal(recovered.status, 200, 'the account must recover without operator action');
  });

  it('keeps the brute-force counter per identity, not global', async () => {
    const victim = await createUser(fixture.school.id, UserRole.SCHOOL_ADMIN);
    const bystander = await createUser(fixture.school.id, UserRole.SCHOOL_ADMIN);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await attemptLogin(victim.email, 'wrong-password');
    }
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const other = await attemptLogin(bystander.email, TEST_PASSWORD);
    assert.equal(other.status, 200, 'an unrelated account must not be collateral damage');
  });

  it('throttles SOS creation while keeping the first calls through', async () => {
    const driverSession = await loginWithBackoff(fixture.driver.email);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await httpRequest(app.baseUrl, '/emergencies/sos', {
        method: 'POST',
        token: driverSession.accessToken,
        body: { trip_id: fixture.trip.id, type: 'OTHER', message: 'help' },
      });
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
    assert.ok(statuses[0] !== 429, 'the first SOS must always get through');
  });

  it('throttles attendance mutations', async () => {
    const driverSession = await loginWithBackoff(fixture.driver.email);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await httpRequest(
        app.baseUrl,
        `/trips/${fixture.trip.id}/students/${fixture.student.id}/board`,
        { method: 'POST', token: driverSession.accessToken },
      );
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
  });

  it('throttles the GPS/location read path', async () => {
    const driverSession = await loginWithBackoff(fixture.driver.email);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await httpRequest(app.baseUrl, `/trips/${fixture.trip.id}/location`, {
        token: driverSession.accessToken,
      });
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
  });

  it('throttles expensive list endpoints', async () => {
    const adminSession = await loginWithBackoff(fixture.admin.email);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await httpRequest(app.baseUrl, '/students?page=1&limit=50', {
        token: adminSession.accessToken,
      });
      statuses.push(response.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
    assert.equal(statuses[0], 200, 'normal use is unaffected');
  });

  it('does not rate-limit unprotected endpoints such as health', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await httpRequest(app.baseUrl, '/health');
      assert.equal(response.status, 200);
    }
  });
});
