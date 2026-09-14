import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Sequelize } from 'sequelize-typescript';
import { UserRole } from '@school-bus-tracking/shared-types';
import { prepareDatabase, truncateAll } from '../support/database';
import { createFullSchool, createUser, SchoolFixture } from '../support/fixtures';
import { startTestApp, TestApp } from '../support/app';
import { login, TestSession } from '../support/auth';
import { errorMessage, httpRequest } from '../support/http';

/**
 * Crew (mobile) access + session-isolation regression suite.
 *
 * Background: the driver mobile app repeatedly logged
 * `ApiClientError: Request failed with status 403` after login. Root cause
 * was a role/permission mismatch — the crew screens called the
 * school-admin-only list endpoints `GET /routes` and `GET /buses` to resolve
 * route/bus labels, which the API rejects with 403 for every crew request,
 * on every screen load.
 *
 * The fix is on the client (the crew app resolves labels from the
 * server-enriched trip payload instead of admin list endpoints), and this
 * suite pins both halves of the contract:
 *
 * 1. A valid driver/conductor session runs its entire mobile request set
 *    with zero 403s (no repeated 403 after login).
 * 2. Trip rows carry the route/bus display labels the crew UI renders, so
 *    the crew app never needs the admin list endpoints.
 * 3. The list endpoints stay school-admin only (least privilege — the fix
 *    must not open fleet/route enumeration to crew accounts).
 * 4. One user's web navigation (a burst of normal admin API requests) cannot
 *    change another user's session: the driver's token and refresh cookie
 *    keep working, byte-identical, after the admin acts — the cross-device
 *    "admin clicks menus → driver app refreshes" report.
 */
describe('crew mobile access + session isolation (E2E)', () => {
  let sequelize: Sequelize;
  let app: TestApp;
  let alpha: SchoolFixture;
  let beta: SchoolFixture;
  let adminA: TestSession;
  let driverA: TestSession;
  let conductorA: TestSession;
  let parentA: TestSession;
  let _driverB: TestSession;
  let _superAdmin: TestSession;

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);

    alpha = await createFullSchool(sequelize);
    beta = await createFullSchool(sequelize);
    const superAdmin = await createUser(null, UserRole.SUPER_ADMIN);

    app = await startTestApp();

    adminA = await login(app.baseUrl, alpha.school.code, alpha.admin.email);
    driverA = await login(app.baseUrl, alpha.school.code, alpha.driver.email);
    conductorA = await login(app.baseUrl, alpha.school.code, alpha.conductor.email);
    parentA = await login(app.baseUrl, alpha.school.code, alpha.parent.email);
    _driverB = await login(app.baseUrl, beta.school.code, beta.driver.email);
    _superAdmin = await login(app.baseUrl, null, superAdmin.email);
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
  });

  /** Runs one request and asserts it is not a role/permission rejection. */
  async function expectNotForbidden(
    session: TestSession,
    method: string,
    path: string,
    label: string,
  ): Promise<number> {
    const response = await httpRequest(app.baseUrl, path, {
      method,
      token: session.accessToken,
    });
    assert.notEqual(
      response.status,
      403,
      `${label}: ${method} ${path} returned 403 for a valid crew session — ` +
        `a repeated 403 after login would be logged by the mobile app. ` +
        `Body: ${JSON.stringify(response.body)}`,
    );
    return response.status;
  }

  // =========================================================================
  // 1. Driver startup flow — no repeated 403s
  // =========================================================================
  describe('driver startup request set', () => {
    it('a valid driver session gets no 403 from any endpoint the crew app calls', async () => {
      // `GET /trips` — the crew app's primary load (scoped to the caller's runs).
      const trips = await httpRequest<{
        success: boolean;
        data: { items: Array<{ id: string }> };
      }>(app.baseUrl, '/trips?page=1&limit=25', { token: driverA.accessToken });
      assert.equal(trips.status, 200);
      const ownTrip = trips.body.data.items.find((trip) => trip.id === alpha.trip.id);
      assert.ok(ownTrip, 'driver must see their own run in GET /trips');

      // Per-trip reads the trip/manifest/stops screens perform.
      await expectNotForbidden(driverA, 'GET', `/trips/${alpha.trip.id}`, 'trip detail');
      await expectNotForbidden(driverA, 'GET', `/trips/${alpha.trip.id}/students`, 'manifest list');
      await expectNotForbidden(driverA, 'GET', `/trips/${alpha.trip.id}/arrivals`, 'arrivals');
      await expectNotForbidden(driverA, 'GET', `/trips/${alpha.trip.id}/eta`, 'eta');
      // No GPS fix yet → 404 by design, but never a 403.
      const location = await expectNotForbidden(
        driverA,
        'GET',
        `/trips/${alpha.trip.id}/location`,
        'latest location',
      );
      assert.ok(location === 200 || location === 404);
      // Route stops of the trip's route (crew-authorized detail surface).
      await expectNotForbidden(driverA, 'GET', `/routes/${alpha.route.id}/stops`, 'route stops');
    });

    it('a valid conductor session gets no 403 either', async () => {
      const trips = await httpRequest(app.baseUrl, '/trips?page=1&limit=25', {
        token: conductorA.accessToken,
      });
      assert.equal(trips.status, 200);
      await expectNotForbidden(conductorA, 'GET', `/trips/${alpha.trip.id}/students`, 'manifest');
      await expectNotForbidden(conductorA, 'GET', `/routes/${alpha.route.id}/stops`, 'stops');
    });

    it('driver requests stay scoped to their own school', async () => {
      const trips = await httpRequest<{
        success: boolean;
        data: { items: Array<{ id: string }> };
      }>(app.baseUrl, '/trips?page=1&limit=100', { token: driverA.accessToken });
      assert.equal(trips.status, 200);
      assert.ok(
        trips.body.data.items.some((trip) => trip.id === alpha.trip.id),
        'own trip present',
      );
      assert.ok(
        !trips.body.data.items.some((trip) => trip.id === beta.trip.id),
        'another school’s trip must never appear',
      );
    });
  });

  // =========================================================================
  // 2. Trip rows carry the crew UI labels (no admin list calls needed)
  // =========================================================================
  describe('crew label contract', () => {
    it('GET /trips rows carry route and bus display fields for the crew UI', async () => {
      const trips = await httpRequest<{
        success: boolean;
        data: {
          items: Array<{
            id: string;
            route_code: string | null;
            route_name: string | null;
            registration_number: string | null;
            bus_number: string | null;
          }>;
        };
      }>(app.baseUrl, '/trips?page=1&limit=25', { token: driverA.accessToken });
      assert.equal(trips.status, 200);
      const ownTrip = trips.body.data.items.find((trip) => trip.id === alpha.trip.id);
      assert.ok(ownTrip);
      // The mobile crew screens render these directly — they must be present
      // so the app never has to call the admin-only `GET /routes` / `GET /buses`.
      assert.equal(ownTrip!.route_code, alpha.route.code);
      assert.equal(ownTrip!.route_name, alpha.route.name);
      assert.equal(ownTrip!.registration_number, alpha.bus.registration_number);
      assert.equal(ownTrip!.bus_number, alpha.bus.bus_number);
    });
  });

  // =========================================================================
  // 3. Admin list endpoints stay admin-only (least privilege)
  // =========================================================================
  describe('list endpoint role boundaries', () => {
    it('crew roles are still refused the school-admin list endpoints', async () => {
      const checks: Array<[TestSession, string, string]> = [
        [driverA, '/routes?page=1&limit=100', 'driver /routes'],
        [driverA, '/buses?page=1&limit=100', 'driver /buses'],
        [conductorA, '/routes?page=1&limit=100', 'conductor /routes'],
        [conductorA, '/buses?page=1&limit=100', 'conductor /buses'],
        [parentA, '/buses?page=1&limit=100', 'parent /buses'],
      ];
      for (const [session, path, label] of checks) {
        const response = await httpRequest(app.baseUrl, path, { token: session.accessToken });
        assert.equal(
          response.status,
          403,
          `${label} must stay school-admin only (least privilege)`,
        );
        assert.equal(errorMessage(response.body), 'Insufficient role permissions');
      }
    });

    it('a super admin still cannot read tenant list endpoints', async () => {
      const response = await httpRequest(app.baseUrl, '/routes?page=1', {
        token: _superAdmin.accessToken,
      });
      assert.equal(response.status, 403);
    });

    it('school admin keeps the list endpoints', async () => {
      for (const path of ['/routes?page=1&limit=100', '/buses?page=1&limit=100']) {
        const response = await httpRequest(app.baseUrl, path, { token: adminA.accessToken });
        assert.equal(response.status, 200, `admin ${path} must keep working`);
      }
    });
  });

  // =========================================================================
  // 4. Cross-user / cross-device session isolation
  // =========================================================================
  describe('cross-user session isolation', () => {
    it('an admin menu sweep cannot change the driver’s auth state or data', async () => {
      const driverBefore = await httpRequest<{
        success: boolean;
        data: { items: unknown[] };
      }>(app.baseUrl, '/trips?page=1&limit=25', { token: driverA.accessToken });
      assert.equal(driverBefore.status, 200);

      // Normal School Admin web navigation: a burst of the menu's reads.
      const adminPaths = [
        '/dashboard/stats',
        '/trips?page=1&limit=20',
        '/routes?page=1&limit=20',
        '/buses?page=1&limit=20',
        '/stops?page=1&limit=20',
        '/students?page=1&limit=20',
        '/parents?page=1&limit=20',
        '/trips?page=1&limit=20&status=SCHEDULED',
      ];
      for (const path of adminPaths) {
        const response = await httpRequest(app.baseUrl, path, { token: adminA.accessToken });
        assert.equal(response.status, 200, `admin navigation ${path} must succeed`);
      }

      // The driver’s token must be untouched: same data, same credentials.
      const driverAfter = await httpRequest<{
        success: boolean;
        data: { items: unknown[] };
      }>(app.baseUrl, '/trips?page=1&limit=25', { token: driverA.accessToken });
      assert.equal(driverAfter.status, 200);
      assert.deepEqual(driverAfter.body.data.items, driverBefore.body.data.items);
    });

    it('admin and driver refresh sessions independently (no shared rotation)', async () => {
      // Each client holds its own httpOnly refresh cookie; a refresh rotates
      // only the presented token. Rotating the admin’s session must leave the
      // driver’s cookie fully valid — and vice versa.
      const adminRefresh = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        cookies: { refresh_token: adminA.refreshCookie ?? '' },
      });
      assert.equal(adminRefresh.status, 200, 'admin refresh must succeed');

      const driverRefresh = await httpRequest(app.baseUrl, '/auth/refresh', {
        method: 'POST',
        cookies: { refresh_token: driverA.refreshCookie ?? '' },
      });
      assert.equal(
        driverRefresh.status,
        200,
        'driver refresh must still succeed after the admin rotated their own session',
      );

      // And the driver’s access token issued before the admin refresh is
      // still valid — navigation on the other device revoked nothing.
      const driverTrip = await httpRequest(app.baseUrl, '/trips?page=1&limit=1', {
        token: driverA.accessToken,
      });
      assert.equal(driverTrip.status, 200);
    });

    it('a driver’s session cannot read another school’s crew data', async () => {
      const cross = await httpRequest(app.baseUrl, `/trips/${beta.trip.id}`, {
        token: driverA.accessToken,
      });
      assert.equal(cross.status, 404, 'cross-tenant trip detail must stay invisible');
    });
  });
});
