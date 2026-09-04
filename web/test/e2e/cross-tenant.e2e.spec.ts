import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import { prepareDatabase, truncateAll } from '../support/database';
import { createFullSchool, createStudent, createUser, SchoolFixture } from '../support/fixtures';
import { startTestApp, TestApp } from '../support/app';
import { login, TestSession } from '../support/auth';
import { errorMessage, httpRequest } from '../support/http';
import { Bus, Student, Trip } from '../../src/server/database/models';

/**
 * Cross-tenant security, end to end over real HTTP against a real database.
 *
 * Every request below is a genuine authenticated call through the whole
 * pipeline (guards, tenant scoping, services, SQL). The rule under test is
 * uniform: a caller of tenant A must never observe, modify or *learn about the
 * existence of* a row belonging to tenant B — the API answers with the same
 * generic 404 it returns for an id that does not exist at all.
 */
describe('cross-tenant access control (real HTTP + PostgreSQL)', () => {
  let sequelize: Sequelize;
  let app: TestApp;
  let alpha: SchoolFixture;
  let beta: SchoolFixture;
  let adminA: TestSession;
  let adminB: TestSession;
  let parentA: TestSession;
  let driverA: TestSession;
  let conductorA: TestSession;
  let superAdminSession: TestSession;

  /** A control id that exists nowhere, to compare responses against. */
  const ghostId = randomUUID();

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);

    alpha = await createFullSchool(sequelize);
    beta = await createFullSchool(sequelize);
    const superAdmin = await createUser(null, UserRole.SUPER_ADMIN);

    app = await startTestApp();

    adminA = await login(app.baseUrl, alpha.school.code, alpha.admin.email);
    adminB = await login(app.baseUrl, beta.school.code, beta.admin.email);
    parentA = await login(app.baseUrl, alpha.school.code, alpha.parent.email);
    driverA = await login(app.baseUrl, alpha.school.code, alpha.driver.email);
    conductorA = await login(app.baseUrl, alpha.school.code, alpha.conductor.email);
    superAdminSession = await login(app.baseUrl, null, superAdmin.email);
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
  });

  /** Asserts a generic 404 that discloses nothing about the other tenant. */
  async function expectGenericNotFound(
    session: TestSession,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<void> {
    const crossTenant = await httpRequest(app.baseUrl, path, {
      method,
      token: session.accessToken,
      body,
    });
    assert.equal(crossTenant.status, 404, `${method} ${path} should be 404`);

    const message = errorMessage(crossTenant.body) ?? '';
    // No identifier of the other tenant may leak into the message.
    assert.doesNotMatch(message, /school/i);
    assert.ok(message.length < 120);
  }

  describe('tenant A acting on tenant B resources', () => {
    it('cannot read or mutate another school\'s student', async () => {
      await expectGenericNotFound(adminA, 'GET', `/students/${beta.student.id}`);
      await expectGenericNotFound(adminA, 'PATCH', `/students/${beta.student.id}`, {
        first_name: 'Hijacked',
      });
      await expectGenericNotFound(adminA, 'DELETE', `/students/${beta.student.id}`);

      const untouched = await Student.findByPk(beta.student.id);
      assert.equal(untouched?.first_name, beta.student.first_name);
    });

    it('cannot read another school\'s parent or its guardian links', async () => {
      await expectGenericNotFound(adminA, 'GET', `/parents/${beta.parent.id}`);
      await expectGenericNotFound(adminA, 'GET', `/parents/${beta.parent.id}/students`);
      await expectGenericNotFound(adminA, 'PATCH', `/parents/${beta.parent.id}`, {
        first_name: 'Hijacked',
      });
    });

    it('cannot read or mutate another school\'s bus', async () => {
      await expectGenericNotFound(adminA, 'GET', `/buses/${beta.bus.id}`);
      await expectGenericNotFound(adminA, 'PATCH', `/buses/${beta.bus.id}`, { capacity: 1 });
      await expectGenericNotFound(adminA, 'DELETE', `/buses/${beta.bus.id}`);

      const untouched = await Bus.findByPk(beta.bus.id);
      assert.equal(untouched?.capacity, 40);
    });

    it('cannot read or mutate another school\'s route or stop', async () => {
      await expectGenericNotFound(adminA, 'GET', `/routes/${beta.route.id}`);
      await expectGenericNotFound(adminA, 'PATCH', `/routes/${beta.route.id}`, { name: 'X' });
      await expectGenericNotFound(adminA, 'GET', `/stops/${beta.stop.id}`);
    });

    it('cannot read or mutate another school\'s route assignment', async () => {
      await expectGenericNotFound(adminA, 'GET', `/route-assignments/${beta.assignment.id}`);
      await expectGenericNotFound(adminA, 'DELETE', `/route-assignments/${beta.assignment.id}`);
    });

    it('cannot read or mutate another school\'s trip', async () => {
      await expectGenericNotFound(adminA, 'GET', `/trips/${beta.trip.id}`);
      await expectGenericNotFound(adminA, 'PATCH', `/trips/${beta.trip.id}/status`, {
        status: 'CANCELLED',
      });
      await expectGenericNotFound(adminA, 'DELETE', `/trips/${beta.trip.id}`);

      const untouched = await Trip.findByPk(beta.trip.id);
      assert.equal(untouched?.status, beta.trip.status);
    });

    it('cannot read another school\'s bus documents', async () => {
      await expectGenericNotFound(adminA, 'GET', `/buses/${beta.bus.id}/documents`);
      await expectGenericNotFound(
        adminA,
        'GET',
        `/buses/${beta.bus.id}/documents/${beta.document.id}`,
      );
    });

    it('cannot read another school\'s trip manifest or live location', async () => {
      await expectGenericNotFound(adminA, 'GET', `/trips/${beta.trip.id}/students`);
      await expectGenericNotFound(adminA, 'GET', `/trips/${beta.trip.id}/location`);
    });

    it('cannot read or act on another school\'s emergency', async () => {
      await expectGenericNotFound(adminA, 'GET', `/emergencies/${beta.emergency.id}`);
      await expectGenericNotFound(adminA, 'PATCH', `/emergencies/${beta.emergency.id}/status`, {
        status: 'ACKNOWLEDGED',
      });
    });

    it('answers identically for a foreign id and a non-existent id', async () => {
      const foreign = await httpRequest(app.baseUrl, `/buses/${beta.bus.id}`, {
        token: adminA.accessToken,
      });
      const ghost = await httpRequest(app.baseUrl, `/buses/${ghostId}`, {
        token: adminA.accessToken,
      });
      assert.equal(foreign.status, ghost.status);
      assert.deepEqual(errorMessage(foreign.body), errorMessage(ghost.body));
    });

    it('never lists foreign rows in collection endpoints', async () => {
      const buses = await httpRequest<{ data: { items: { id: string }[] } }>(
        app.baseUrl,
        '/buses?page=1&limit=100',
        { token: adminA.accessToken },
      );
      assert.equal(buses.status, 200);
      assert.ok(buses.body.data.items.every((item) => item.id !== beta.bus.id));

      const students = await httpRequest<{ data: { items: { id: string }[] } }>(
        app.baseUrl,
        '/students?page=1&limit=100',
        { token: adminA.accessToken },
      );
      assert.ok(students.body.data.items.every((item) => item.id !== beta.student.id));
    });
  });

  describe('forged tenant identifiers in the payload', () => {
    it('ignores a forged school_id when creating a bus', async () => {
      const created = await httpRequest<{ data: { id: string; school_id: string } }>(
        app.baseUrl,
        '/buses',
        {
          method: 'POST',
          token: adminA.accessToken,
          body: {
            registration_number: `FORGE-${randomUUID().slice(0, 6)}`,
            capacity: 12,
            school_id: beta.school.id,
          },
        },
      );

      // The DTO whitelist rejects the unknown field outright, or the service
      // overrides it — either way the row must never land in tenant B.
      if (created.status === 201) {
        assert.equal(created.body.data.school_id, alpha.school.id);
        const row = await Bus.findByPk(created.body.data.id);
        assert.equal(row?.school_id, alpha.school.id);
      } else {
        assert.equal(created.status, 400);
      }
      assert.equal(await Bus.count({ where: { school_id: beta.school.id } }), 1);
    });

    it('ignores a forged school_id when updating an own resource', async () => {
      const updated = await httpRequest(app.baseUrl, `/buses/${alpha.bus.id}`, {
        method: 'PATCH',
        token: adminA.accessToken,
        body: { capacity: 33, school_id: beta.school.id },
      });
      assert.ok([200, 400].includes(updated.status));

      const row = await Bus.findByPk(alpha.bus.id);
      assert.equal(row?.school_id, alpha.school.id);
    });
  });

  describe('role-scoped isolation inside a tenant', () => {
    it('a parent cannot read another parent\'s child', async () => {
      const otherParent = await createUser(alpha.school.id, UserRole.PARENT);
      const otherChild = await createStudent(alpha.school.id, alpha.stop.id);
      const otherParentSession = await login(
        app.baseUrl,
        alpha.school.code,
        otherParent.email,
      );

      const response = await httpRequest(
        app.baseUrl,
        `/parent/children/${alpha.student.id}`,
        { token: otherParentSession.accessToken },
      );
      assert.equal(response.status, 404);

      const own = await httpRequest(app.baseUrl, `/parent/children/${alpha.student.id}`, {
        token: parentA.accessToken,
      });
      assert.equal(own.status, 200);
      assert.ok(otherChild.id);
    });

    it('a parent cannot read a child of another school', async () => {
      const response = await httpRequest(app.baseUrl, `/parent/children/${beta.student.id}`, {
        token: parentA.accessToken,
      });
      assert.equal(response.status, 404);
    });

    it('a driver cannot act on another driver\'s trip', async () => {
      const foreignTrip = await httpRequest(app.baseUrl, `/trips/${beta.trip.id}`, {
        token: driverA.accessToken,
      });
      assert.equal(foreignTrip.status, 404);

      const otherDriver = await createUser(alpha.school.id, UserRole.DRIVER);
      const otherDriverSession = await login(app.baseUrl, alpha.school.code, otherDriver.email);
      const notMine = await httpRequest(
        app.baseUrl,
        `/trips/${alpha.trip.id}/students/${alpha.student.id}/board`,
        { method: 'POST', token: otherDriverSession.accessToken },
      );
      assert.ok([403, 404].includes(notMine.status), `unexpected ${notMine.status}`);
    });

    it('a conductor cannot modify a trip of another school', async () => {
      const response = await httpRequest(app.baseUrl, `/trips/${beta.trip.id}/status`, {
        method: 'PATCH',
        token: conductorA.accessToken,
        body: { status: 'CANCELLED' },
      });
      assert.equal(response.status, 404);

      const untouched = await Trip.findByPk(beta.trip.id);
      assert.equal(untouched?.status, beta.trip.status);
    });

    it('a parent cannot reach school-admin endpoints of their own school', async () => {
      const response = await httpRequest(app.baseUrl, '/buses', {
        method: 'POST',
        token: parentA.accessToken,
        body: { registration_number: 'PARENT-1', capacity: 10 },
      });
      assert.equal(response.status, 403);
    });
  });

  describe('lifecycle checks on an otherwise valid JWT', () => {
    it('refuses a token issued for a school that is later deactivated', async () => {
      const doomed = await createFullSchool(sequelize);
      const session = await login(app.baseUrl, doomed.school.code, doomed.admin.email);

      const before = await httpRequest(app.baseUrl, '/buses', { token: session.accessToken });
      assert.equal(before.status, 200);

      await doomed.school.update({ is_active: false });

      const after = await httpRequest(app.baseUrl, '/buses', { token: session.accessToken });
      assert.equal(after.status, 403);
      assert.match(String(errorMessage(after.body)), /inactive/i);
    });

    it('refuses a token of a user who is later deactivated', async () => {
      const school = alpha;
      const user = await createUser(school.school.id, UserRole.SCHOOL_ADMIN);
      const session = await login(app.baseUrl, school.school.code, user.email);
      assert.equal(
        (await httpRequest(app.baseUrl, '/buses', { token: session.accessToken })).status,
        200,
      );

      await user.update({ is_active: false });

      const after = await httpRequest(app.baseUrl, '/buses', { token: session.accessToken });
      assert.equal(after.status, 403);
      assert.match(String(errorMessage(after.body)), /inactive/i);
    });

    it('rejects a missing, malformed or foreign-signed token', async () => {
      assert.equal((await httpRequest(app.baseUrl, '/buses')).status, 401);
      assert.equal(
        (await httpRequest(app.baseUrl, '/buses', { token: 'not-a-jwt' })).status,
        401,
      );
      const tampered = `${adminA.accessToken.slice(0, -3)}abc`;
      assert.equal((await httpRequest(app.baseUrl, '/buses', { token: tampered })).status, 401);
    });
  });

  describe('platform SUPER_ADMIN', () => {
    it('reaches the platform endpoints of both tenants', async () => {
      const schoolsList = await httpRequest(app.baseUrl, '/admin/schools?page=1&limit=100', {
        token: superAdminSession.accessToken,
      });
      assert.equal(schoolsList.status, 200);

      for (const fixture of [alpha, beta]) {
        const detail = await httpRequest(app.baseUrl, `/admin/schools/${fixture.school.id}`, {
          token: superAdminSession.accessToken,
        });
        assert.equal(detail.status, 200);
      }
    });

    it('is still refused the tenant-scoped endpoints (no school context)', async () => {
      const response = await httpRequest(app.baseUrl, '/buses', {
        token: superAdminSession.accessToken,
      });
      assert.equal(response.status, 403);
    });

    it('is the only role allowed on the admin surface', async () => {
      const response = await httpRequest(app.baseUrl, '/admin/schools?page=1&limit=20', {
        token: adminB.accessToken,
      });
      assert.equal(response.status, 403);
    });
  });
});
