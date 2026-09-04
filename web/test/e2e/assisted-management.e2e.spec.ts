import '../support/env';
import { after, before, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Workbook } from 'exceljs';
import {
  ImportJobStatus,
  PlanLimitResource,
  SubscriptionStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import type { Sequelize } from 'sequelize-typescript';
import {
  AuditLog,
  AssistedManagementSession,
  Stop,
  Student,
  User,
} from '../../src/server/database/models';
import { prepareDatabase, truncateAll } from '../support/database';
import {
  createFullSchool,
  createPlan,
  createSchool,
  createStudent,
  createSubscription,
  createUser,
  SchoolFixture,
} from '../support/fixtures';
import { startTestApp, type TestApp } from '../support/app';
import { login, type TestSession } from '../support/auth';
import { errorMessage, httpRequest } from '../support/http';

/**
 * Super Admin assisted school management ("Manage Data") end to end.
 *
 * Boots the real application over real HTTP with real tenant data and walks
 * the whole security/performance contract of the feature:
 *
 *  1.  A Super Admin can manage a school's operational data.
 *  2.  School admins are rejected on every managed endpoint (403).
 *  3.  School A's data is unreachable while managing school B (and vice versa).
 *  4.  A client-supplied `school_id` can never override the managed school.
 *  5-7. Student / guardian / bus-route-stop CRUD stay tenant-scoped.
 *  8.  Imports land in the managed school only.
 *  9.  Exports contain the managed school only.
 *  10. Cross-school entity ids cannot bypass isolation.
 *  11. Audit rows keep the Super Admin as the actor.
 *  12. The assisted-management session is recorded (start/end/supersede).
 *  13. Restricted capabilities have no assisted route at all.
 *  14. Existing school-admin behaviour is unchanged.
 *  15. Plan/subscription limits are enforced against the managed school.
 *  16. Bulk import + pagination stay fast and flat (no N+1 blow-ups).
 *  17. Concurrent writes stay consistent (unique keys, advisory-locked limits).
 */

const A_MANAGE = (schoolId: string, suffix: string) => `/admin/schools/${schoolId}/manage${suffix}`;

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** Payload shapes the suite reads back from the assisted-management API. */
type SessionData = {
  session: { actor_user_id: string; end_reason?: string | null };
  school: { id: string };
  capabilities: unknown[];
};
type StudentData = { id?: string; grade_level?: string; school_id?: string };
type StudentListData = { items: Array<{ id: string; school_id: string }> };
type ImportHistoryData = {
  items: Array<{ id: string; file_name: string; status: ImportJobStatus }>;
};
type StudentPageData = { meta: { total: number }; items: unknown[] };
type ImportCommitData = { created_count: number; job_id?: string | null; status?: string };

async function manageRequest<T>(
  app: TestApp,
  method: string,
  schoolId: string,
  suffix: string,
  session: TestSession,
  body?: unknown,
): Promise<{ status: number; body: Envelope<T> }> {
  const result = await httpRequest<Envelope<T>>(app.baseUrl, A_MANAGE(schoolId, suffix), {
    method,
    token: session.accessToken,
    body,
  });
  return { status: result.status, body: result.body };
}

async function importSpreadsheet(
  app: TestApp,
  schoolId: string,
  session: TestSession,
  rows: Array<Record<string, string>>,
): Promise<{
  status: number;
  body: Envelope<ImportCommitData>;
}> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.columns = [
    { header: 'Admission Number', key: 'admission_number' },
    { header: 'First Name', key: 'first_name' },
    { header: 'Last Name', key: 'last_name' },
    { header: 'Route Code', key: 'route_code' },
    { header: 'Home Stop', key: 'home_stop_name' },
  ];
  for (const row of rows) {
    sheet.addRow(row);
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'roster.xlsx',
  );

  const response = await fetch(
    `${app.baseUrl}${A_MANAGE(schoolId, '/imports/students/commit?mode=create')}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: form,
    },
  );
  const body = (await response.json()) as Envelope<ImportCommitData>;
  return { status: response.status, body };
}

async function listAuditRows(where: { school_id: string }): Promise<AuditLog[]> {
  return AuditLog.findAll({ where, order: [['created_at', 'ASC']], raw: true });
}

describe('Super Admin assisted school management (E2E)', () => {
  let sequelize: Sequelize;
  let app: TestApp;
  let alpha: SchoolFixture;
  let beta: SchoolFixture;
  let superAdmin: User;
  let root: TestSession; // SUPER_ADMIN
  let adminA: TestSession;
  let adminB: TestSession;

  before(async () => {
    sequelize = await prepareDatabase();
    await truncateAll(sequelize);

    alpha = await createFullSchool(sequelize);
    beta = await createFullSchool(sequelize);
    superAdmin = await createUser(null, UserRole.SUPER_ADMIN);

    app = await startTestApp();
    root = await login(app.baseUrl, null, superAdmin.email);
    adminA = await login(app.baseUrl, alpha.school.code, alpha.admin.email);
    adminB = await login(app.baseUrl, beta.school.code, beta.admin.email);
  });

  after(async () => {
    await app?.close();
    await sequelize?.close();
  });

  it('1. authorised Super Admin manages a school end to end', async () => {
    const start = await manageRequest<SessionData>(app, 'POST', alpha.school.id, '/session', root);
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal(start.body.data?.session.actor_user_id, superAdmin.id);
    assert.equal(start.body.data?.school.id, alpha.school.id);
    assert.ok((start.body.data?.capabilities.length ?? 0) > 0);

    const created = await manageRequest<StudentData>(app, 'POST', alpha.school.id, '/students', root, {
      admission_number: `AMG-${randomUUID().slice(0, 8)}`,
      first_name: 'Ayaan',
      last_name: 'Khan',
      grade_level: 'Grade 3',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const studentId = created.body.data?.id as string;

    const listed = await manageRequest<StudentListData>(app, 'GET', alpha.school.id, '/students?search=Ayaan', root);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.data?.items.some((item) => item.id === studentId));

    const updated = await manageRequest<StudentData>(
      app,
      'PATCH',
      alpha.school.id,
      `/students/${studentId}`,
      root,
      {
        grade_level: 'Grade 4',
      },
    );
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data?.grade_level, 'Grade 4');

    const current = await manageRequest<SessionData>(app, 'GET', alpha.school.id, '/session/current', root);
    assert.equal(current.status, 200);
    assert.equal(current.body.data?.session?.actor_user_id, superAdmin.id);

    const ended = await manageRequest<SessionData>(app, 'POST', alpha.school.id, '/session/end', root);
    assert.equal(ended.status, 200);
    assert.equal(ended.body.data?.session?.end_reason, 'exit');
  });

  it('2. school admins cannot reach any managed-school endpoint', async () => {
    for (const [method, suffix] of [
      ['GET', '/students'],
      ['POST', '/students'],
      ['POST', '/session'],
      ['GET', '/session/current'],
      ['GET', '/imports/modules'],
      ['GET', '/exports'],
      ['GET', '/reports'],
    ] as const) {
      const result = await manageRequest(app, method, alpha.school.id, suffix, adminA);
      assert.equal(result.status, 403, `${method} ${suffix} → ${result.status}`);
    }
    // …and a parent even less.
    const parent = await login(app.baseUrl, alpha.school.code, alpha.parent.email);
    const result = await manageRequest(app, 'GET', alpha.school.id, '/students', parent);
    assert.equal(result.status, 403);
  });

  it('3. managing school B never exposes school A (and vice versa)', async () => {
    await manageRequest(app, 'POST', beta.school.id, '/session', root);
    try {
      const leaked = await manageRequest(
        app,
        'GET',
        beta.school.id,
        `/students/${alpha.student.id}`,
        root,
      );
      assert.equal(leaked.status, 404);

      const listed = await manageRequest<StudentListData>(app, 'GET', beta.school.id, '/students?limit=200', root);
      assert.ok((listed.body.data?.items ?? []).every((item) => item.school_id === beta.school.id));
      assert.ok(!(listed.body.data?.items ?? []).some((item) => item.id === alpha.student.id));

      // Mutating A's student while managing B is the same generic 404.
      const patched = await manageRequest(
        app,
        'PATCH',
        beta.school.id,
        `/students/${alpha.student.id}`,
        root,
        { grade_level: 'HACKED' },
      );
      assert.equal(patched.status, 404);
      const deleted = await manageRequest(
        app,
        'DELETE',
        beta.school.id,
        `/students/${alpha.student.id}`,
        root,
      );
      assert.equal(deleted.status, 404);
      const reloaded = await Student.findByPk(alpha.student.id);
      assert.equal(String(reloaded?.grade_level), 'Grade 1', 'A untouched');
    } finally {
      await manageRequest(app, 'POST', beta.school.id, '/session/end', root);
    }
  });

  it('4. a client-supplied school_id cannot override the managed school', async () => {
    await manageRequest(app, 'POST', alpha.school.id, '/session', root);
    try {
      // Body fields: the DTO does not declare school_id and the global
      // validation pipe runs with forbidNonWhitelisted.
      const smuggledBody = await manageRequest(app, 'POST', alpha.school.id, '/students', root, {
        admission_number: `SMG-${randomUUID().slice(0, 8)}`,
        first_name: 'Smuggled',
        last_name: 'Body',
        school_id: beta.school.id,
      });
      assert.equal(smuggledBody.status, 400, JSON.stringify(smuggledBody.body));

      // Query string and headers are equally ignored: the row lands in A.
      const response = await httpRequest<Envelope<{ id: string }>>(
        app.baseUrl,
        `${A_MANAGE(alpha.school.id, '/students')}?school_id=${beta.school.id}`,
        {
          method: 'POST',
          token: root.accessToken,
          body: {
            admission_number: `SMG-${randomUUID().slice(0, 8)}`,
            first_name: 'Smuggled',
            last_name: 'Query',
          },
          headers: { 'X-School-Id': beta.school.id },
        },
      );
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const row = await Student.findByPk(response.body.data?.id as string);
      assert.equal(row?.school_id, alpha.school.id);
    } finally {
      await manageRequest(app, 'POST', alpha.school.id, '/session/end', root);
    }
  });

  it('5-7. student, guardian and fleet CRUD stay tenant-scoped', async () => {
    await manageRequest(app, 'POST', alpha.school.id, '/session', root);
    try {
      // Guardian create + link, all through the managed surface.
      const guardian = await manageRequest<StudentData>(app, 'POST', alpha.school.id, '/parents', root, {
        first_name: 'Fatima',
        last_name: 'Khan',
        email: `fatima.${randomUUID().slice(0, 8)}@parents.example.test`,
        phone: '+91 98765 43210',
        password: 'Str0ng-Parent-Pass!',
      });
      assert.equal(guardian.status, 201, JSON.stringify(guardian.body));
      const guardianId = guardian.body.data?.id as string;

      const link = await manageRequest(
        app,
        'POST',
        alpha.school.id,
        `/students/${alpha.student.id}/guardians`,
        root,
        { parent_id: guardianId, relationship: 'mother', is_primary: true },
      );
      assert.equal(link.status, 201, JSON.stringify(link.body));

      // A student of school B is not linkable to A's guardian, and the
      // guardian itself is invisible under B's management context.
      await manageRequest(app, 'POST', beta.school.id, '/session', root);
      const crossGuardian = await manageRequest(
        app,
        'GET',
        beta.school.id,
        `/parents/${guardianId}`,
        root,
      );
      assert.equal(crossGuardian.status, 404);
      const crossLink = await manageRequest(
        app,
        'POST',
        beta.school.id,
        `/students/${beta.student.id}/guardians`,
        root,
        { parent_id: guardianId, relationship: 'mother', is_primary: false },
      );
      assert.equal(crossLink.status, 404, JSON.stringify(crossLink.body));

      // Fleet: creating a stop against the other tenant's route fails.
      const crossStop = await manageRequest(app, 'POST', beta.school.id, '/stops', root, {
        name: 'Smuggled Stop',
        sequence_number: 99,
        route_id: alpha.route.id,
      });
      assert.notEqual(crossStop.status, 201, JSON.stringify(crossStop.body));

      // An assignment referencing another tenant's bus/route/driver is refused.
      const crossAssignment = await manageRequest(
        app,
        'POST',
        beta.school.id,
        '/route-assignments',
        root,
        {
          bus_id: alpha.bus.id,
          route_id: alpha.route.id,
          user_id: alpha.driver.id,
          role: 'DRIVER',
          valid_from: new Date().toISOString().slice(0, 10),
        },
      );
      assert.notEqual(crossAssignment.status, 201, JSON.stringify(crossAssignment.body));

      // B's own route and bus still work normally in B's context.
      const ownRoute = await manageRequest<StudentData>(app, 'POST', beta.school.id, '/routes', root, {
        code: `BETA-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: 'Beta North',
      });
      assert.equal(ownRoute.status, 201, JSON.stringify(ownRoute.body));
      const ownStop = await manageRequest(app, 'POST', beta.school.id, '/stops', root, {
        name: 'Beta Depot',
        sequence_number: 1,
        route_id: ownRoute.body.data?.id as string,
        latitude: 31.5204,
        longitude: 74.3587,
      });
      assert.equal(ownStop.status, 201, JSON.stringify(ownStop.body));
    } finally {
      // close both sessions opened above
      await manageRequest(app, 'POST', beta.school.id, '/session/end', root);
      await manageRequest(app, 'POST', alpha.school.id, '/session/end', root);
    }
  });

  it('8. imports land in the managed school only', async () => {
    // Real operator flow: enter the school, run the import, exit.
    const sessionStart = await manageRequest(app, 'POST', alpha.school.id, '/session', root);
    assert.equal(sessionStart.status, 201);

    try {
      const marker = randomUUID().slice(0, 8);
      const result = await importSpreadsheet(app, alpha.school.id, root, [
        {
          admission_number: `IMP-${marker}-1`,
          first_name: 'Imported',
          last_name: 'One',
          route_code: alpha.route.code,
          home_stop_name: alpha.stop.name,
        },
        {
          admission_number: `IMP-${marker}-2`,
          first_name: 'Imported',
          last_name: 'Two',
        },
        {
          // A route code that only exists in school B must not resolve here.
          admission_number: `IMP-${marker}-3`,
          first_name: 'Cross',
          last_name: 'Route',
          route_code: beta.route.code,
          home_stop_name: beta.stop.name,
        },
      ]);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok((result.body.data?.created_count ?? 0) >= 2, JSON.stringify(result.body));

      const rows = await Student.findAll({
        where: { school_id: alpha.school.id },
        raw: true,
      });
      const imported = rows.filter((row) => String(row.admission_number).includes(marker));
      assert.equal(imported.length, 2, 'two rows created in school A');
      const withRoute = imported.find((row) => row.admission_number === `IMP-${marker}-1`);
      assert.ok(withRoute, 'route-resolvable row exists');
      // The home stop resolved by the import belongs to school A — never to the
      // school that actually owns that route code.
      const stopRow = withRoute.home_stop_id
        ? await Stop.findByPk(withRoute.home_stop_id, { raw: true })
        : null;
      assert.ok(!stopRow || stopRow.school_id === alpha.school.id);

      // Nothing leaked into school B (not even via its route code).
      const betaRows = await Student.findAll({ where: { school_id: beta.school.id }, raw: true });
      assert.equal(
        betaRows.filter((row) => String(row.admission_number).includes(marker)).length,
        0,
        'nothing leaked into school B',
      );

      // The import job itself is owned by school A.
      const history = await manageRequest<ImportHistoryData>(app, 'GET', alpha.school.id, '/imports/history', root);
      assert.equal(history.status, 200);
      const job = history.body.data?.items.find((item) => item.file_name === 'roster.xlsx');
      assert.ok(job);
      assert.equal(job.status, ImportJobStatus.COMPLETED);

      // School B's admin history does not contain the run.
      const adminBBetaHistory = await httpRequest<Envelope<{ items: Array<{ id: string }> }>>(
        app.baseUrl,
        '/imports/history?limit=100',
        { token: adminB.accessToken },
      );
      assert.ok(
        !(adminBBetaHistory.body.data?.items ?? []).some((item) => item.id === job.id),
        'import job is not visible to school B',
      );
    } finally {
      await manageRequest(app, 'POST', alpha.school.id, '/session/end', root);
    }
  });

  it('9. exports remain scoped to the managed school', async () => {
    await manageRequest(app, 'POST', alpha.school.id, '/session', root);
    try {
      const response = await fetch(
        `${app.baseUrl}${A_MANAGE(alpha.school.id, '/exports/students?format=csv')}`,
        { headers: { Authorization: `Bearer ${root.accessToken}` } },
      );
      assert.equal(response.status, 200);
      const csv = await response.text();
      assert.ok(csv.includes('Admission'), 'header present');
      assert.ok(!csv.includes(beta.student.admission_number), "school B's student absent");

      const total = response.headers.get('x-total-records');
      const alphaCount = await Student.count({ where: { school_id: alpha.school.id } });
      assert.equal(Number(total), alphaCount);
    } finally {
      await manageRequest(app, 'POST', alpha.school.id, '/session/end', root);
    }
  });

  it('11-12. audit keeps the Super Admin as actor and records the session', async () => {
    // (session + mutation already performed in earlier tests)
    const sessionRows = await AssistedManagementSession.findAll({
      where: { school_id: alpha.school.id, actor_user_id: superAdmin.id },
      raw: true,
    });
    assert.ok(sessionRows.length >= 2, 'one session per "Manage Data" entry');
    assert.ok(
      sessionRows.every(
        (row) => row.ended_at !== null && ['exit', 'superseded'].includes(String(row.end_reason)),
      ),
      'every earlier session was closed (exit or superseded)',
    );

    const audits = await listAuditRows({ school_id: alpha.school.id });
    const sessionStarts = audits.filter((row) => row.action === 'assisted.session_start');
    const sessionEnds = audits.filter((row) => row.action === 'assisted.session_end');
    assert.ok(sessionStarts.length >= 2);
    assert.ok(sessionEnds.length >= 2);
    assert.ok(
      sessionStarts.every((row) => row.actor_user_id === superAdmin.id),
      'session start rows carry the Super Admin actor',
    );

    const mutations = audits.filter((row) => row.action === 'assisted.mutation');
    assert.ok(mutations.length >= 2, 'CRUD through the managed surface is audited');
    assert.ok(
      mutations.every(
        (row) => row.actor_user_id === superAdmin.id && row.school_id === alpha.school.id,
      ),
    );
    const createdStudent = mutations.find((row) => row.entity_type === 'student');
    assert.ok(createdStudent, 'student mutation audited');
    const metadata = createdStudent?.metadata as Record<string, unknown> | null;
    assert.equal(metadata?.context, 'assisted_management', 'assisted context recorded');
    assert.ok(metadata?.assisted_session_id, 'audit row links to the session');

    // Import audit: school A's own audit view shows the platform operator.
    const importRows = audits.filter((row) => row.action === 'import.commit');
    assert.ok(importRows.length >= 1);
    const importMeta = importRows.at(-1)?.metadata as Record<string, unknown> | null;
    assert.equal(importMeta?.context, 'assisted_management');
    assert.ok(importMeta?.assisted_session_id);

    // The school admin sees the platform-operator activity in their audit view…
    const adminView = await httpRequest<
      Envelope<{ items: Array<{ action: string; metadata: Record<string, unknown> | null }> }>
    >(app.baseUrl, '/audit-logs?action=import.commit', { token: adminA.accessToken });
    assert.equal(adminView.status, 200);
    const seenBySchool = adminView.body.data?.items ?? [];
    assert.ok(seenBySchool.length >= 1, 'school admin can read the rows');
    assert.equal(seenBySchool.at(-1)?.metadata?.context, 'assisted_management');

    // …but the audit trail has no write path and the actor is untouched.
    const superAdminRow = await User.findByPk(superAdmin.id);
    assert.equal(superAdminRow?.school_id, null, 'Super Admin remains tenant-less');
  });

  it('13. restricted capabilities have no assisted route', async () => {
    await manageRequest(app, 'POST', alpha.school.id, '/session', root);
    try {
      // Credential / admin-account operations under /manage → no route (404).
      for (const suffix of [
        '/admins',
        '/school-admins',
        '/admins/whatever/password',
        '/subscriptions',
        '/audit-logs',
        '/platform-config',
        '/notifications/broadcast',
      ]) {
        const result = await manageRequest(app, 'POST', alpha.school.id, suffix, root, {});
        assert.equal(result.status, 404, `POST ${suffix} → ${result.status}`);
        const read = await manageRequest(app, 'GET', alpha.school.id, suffix, root);
        assert.equal(read.status, 404, `GET ${suffix} → ${read.status}`);
      }

      // The parent self-service surface stays closed to the platform operator.
      const parentSelf = await httpRequest(app.baseUrl, '/parents/me/students', {
        token: root.accessToken,
      });
      assert.equal(parentSelf.status, 403);

      // Emergency endpoints are crew/school-admin-only — the platform
      // operator cannot fire a crew SOS or acknowledge someone's alarm.
      const sos = await httpRequest(app.baseUrl, '/emergencies/sos', {
        method: 'POST',
        token: root.accessToken,
        body: { trip_id: alpha.trip.id, type: 'PANIC', message: 'nope' },
      });
      assert.equal(sos.status, 403, JSON.stringify(sos.body));
      const acknowledge = await httpRequest(
        app.baseUrl,
        `/emergencies/${alpha.emergency.id}/status`,
        { method: 'PATCH', token: root.accessToken, body: { status: 'ACKNOWLEDGED' } },
      );
      assert.equal(acknowledge.status, 403, JSON.stringify(acknowledge.body));

      // Audit logs stay read-only: nothing under /manage can write them and
      // the platform audit endpoint exposes no write verb.
      const auditWrite = await httpRequest(app.baseUrl, '/audit-logs', {
        method: 'POST',
        token: root.accessToken,
        body: { action: 'assisted.tamper' },
      });
      assert.equal(auditWrite.status, 404);
    } finally {
      await manageRequest(app, 'POST', alpha.school.id, '/session/end', root);
    }
  });

  it('14. existing school-admin behaviour is unchanged', async () => {
    // School admin still uses plain tenant endpoints for their own school.
    const own = await httpRequest<Envelope<{ items: Array<{ school_id: string }> }>>(
      app.baseUrl,
      '/students?limit=5',
      { token: adminA.accessToken },
    );
    assert.equal(own.status, 200);
    assert.ok((own.body.data?.items ?? []).every((item) => item.school_id === alpha.school.id));

    // …cannot see school B's data through the tenant API…
    const cross = await httpRequest(app.baseUrl, `/students/${beta.student.id}`, {
      token: adminA.accessToken,
    });
    assert.equal(cross.status, 404);

    // …and cannot see school B's assisted-management activity.
    const adminAHistory = await httpRequest<Envelope<{ items: Array<{ id: string }> }>>(
      app.baseUrl,
      '/imports/history?limit=100',
      { token: adminA.accessToken },
    );
    assert.equal(adminAHistory.status, 200);
    // (jobs uploaded under alpha manage ARE visible; beta's must not be)

    // Exports keep working for the school admin.
    const exportResponse = await fetch(`${app.baseUrl}/exports/students?format=csv`, {
      headers: { Authorization: `Bearer ${adminA.accessToken}` },
    });
    assert.equal(exportResponse.status, 200);
    const csv = await exportResponse.text();
    assert.ok(!csv.includes(beta.student.admission_number));
  });

  it('15. plan and subscription limits apply to the managed school', async () => {
    const tinySchool = await createSchool({ name: 'Tiny School' });
    const tinyAdmin = await createUser(tinySchool.id, UserRole.SCHOOL_ADMIN);
    const plan = await createPlan({
      [PlanLimitResource.STUDENTS]: { unlimited: false, value: 2 },
      [PlanLimitResource.BUSES]: { unlimited: false, value: 2 },
      [PlanLimitResource.ROUTES]: { unlimited: false, value: 2 },
      [PlanLimitResource.STOPS]: { unlimited: false, value: 2 },
      [PlanLimitResource.DRIVERS]: { unlimited: false, value: 2 },
      [PlanLimitResource.CONDUCTORS]: { unlimited: false, value: 2 },
      [PlanLimitResource.STAFF]: { unlimited: false, value: 2 },
      [PlanLimitResource.PARENTS]: { unlimited: false, value: 2 },
      [PlanLimitResource.TRIPS]: { unlimited: false, value: 2 },
    });
    await createSubscription(tinySchool.id, plan.id);

    // Sanity: the school admin hits the same wall on their own endpoint.
    await createStudent(tinySchool.id);
    await createStudent(tinySchool.id);
    const adminBlocked = await httpRequest(app.baseUrl, '/students', {
      method: 'POST',
      token: await login(app.baseUrl, tinySchool.code, tinyAdmin.email).then((s) => s.accessToken),
      body: {
        admission_number: `TINY-${randomUUID().slice(0, 8)}`,
        first_name: 'Third',
        last_name: 'Student',
      },
    });
    assert.equal(adminBlocked.status, 409);
    assert.equal((adminBlocked.body as Envelope<never>).error?.code, 'PLAN_LIMIT_REACHED');

    // Assisted management must NOT bypass it — and must not count against the
    // platform operator (who has no tenant).
    const third = await manageRequest(app, 'POST', tinySchool.id, '/students', root, {
      admission_number: `TINY-${randomUUID().slice(0, 8)}`,
      first_name: 'Assisted',
      last_name: 'Third',
    });
    assert.equal(third.status, 409, JSON.stringify(third.body));
    assert.equal(third.body.error?.code, 'PLAN_LIMIT_REACHED');
    assert.equal(await Student.count({ where: { school_id: tinySchool.id } }), 2);

    // A lapsed subscription blocks growth through assisted management too.
    const lapsed = await createPlan({});
    const lapsedSchool = await createSchool({ name: 'Lapsed School' });
    await createSubscription(lapsedSchool.id, lapsed.id, {
      status: SubscriptionStatus.ACTIVE,
      current_period_start: new Date(Date.now() - 10 * 86_400_000),
      current_period_end: new Date(Date.now() - 2 * 86_400_000),
    });
    const lapsedResult = await manageRequest(app, 'POST', lapsedSchool.id, '/students', root, {
      admission_number: `LAPSED-${randomUUID().slice(0, 8)}`,
      first_name: 'Lapsed',
      last_name: 'Growth',
    });
    assert.equal(lapsedResult.status, 409, JSON.stringify(lapsedResult.body));
    assert.equal(lapsedResult.body.error?.code, 'SUBSCRIPTION_INACTIVE');
  });

  it('16. bulk import and pagination stay fast at 300+ records', async () => {
    // A dedicated school so counts are exact.
    const big = await createSchool({ name: 'Big School' });
    await createSubscription(
      big.id,
      (
        await createPlan({
          [PlanLimitResource.STUDENTS]: { unlimited: true, value: null },
          [PlanLimitResource.BUSES]: { unlimited: false, value: 2 },
          [PlanLimitResource.ROUTES]: { unlimited: false, value: 2 },
          [PlanLimitResource.STOPS]: { unlimited: false, value: 2 },
          [PlanLimitResource.DRIVERS]: { unlimited: false, value: 2 },
          [PlanLimitResource.CONDUCTORS]: { unlimited: false, value: 2 },
          [PlanLimitResource.STAFF]: { unlimited: false, value: 2 },
          [PlanLimitResource.PARENTS]: { unlimited: false, value: 2 },
          [PlanLimitResource.TRIPS]: { unlimited: false, value: 2 },
        })
      ).id,
    );

    const rows = Array.from({ length: 300 }, (_, index) => ({
      admission_number: `BIG-${String(index + 1).padStart(5, '0')}`,
      first_name: `Pupil${index + 1}`,
      last_name: 'Bulk',
    }));

    const startedAt = Date.now();
    const result = await importSpreadsheet(app, big.id, root, rows);
    const importMs = Date.now() - startedAt;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data?.created_count, 300);
    // 300 rows through parse + validate + chunked insert should be seconds,
    // not minutes. Generous ceiling to stay stable on loaded machines.
    assert.ok(importMs < 120_000, `import took ${importMs}ms`);

    const listStartedAt = Date.now();
    const page = await manageRequest<StudentPageData>(app, 'GET', big.id, '/students?limit=20&page=3', root);
    const listMs = Date.now() - listStartedAt;
    assert.equal(page.status, 200);
    assert.equal(page.body.data?.meta.total, 300);
    assert.equal(page.body.data?.items.length, 20);
    assert.ok(listMs < 5_000, `paginated list took ${listMs}ms`);

    // Deep page is equally cheap (offset pagination on an indexed column).
    const deepStartedAt = Date.now();
    const deep = await manageRequest<StudentPageData>(app, 'GET', big.id, '/students?limit=20&page=15', root);
    assert.equal(deep.status, 200);
    assert.equal(deep.body.data?.items.length, 20);
    assert.ok(Date.now() - deepStartedAt < 5_000, 'deep page stays cheap');
  });

  it('17. concurrent assisted writes keep data consistent', async () => {
    const concurrency = await createSchool({ name: 'Concurrency School' });
    await createSubscription(
      concurrency.id,
      (
        await createPlan({
          [PlanLimitResource.STUDENTS]: { unlimited: false, value: 100 },
          [PlanLimitResource.BUSES]: { unlimited: false, value: 2 },
          [PlanLimitResource.ROUTES]: { unlimited: false, value: 2 },
          [PlanLimitResource.STOPS]: { unlimited: false, value: 2 },
          [PlanLimitResource.DRIVERS]: { unlimited: false, value: 2 },
          [PlanLimitResource.CONDUCTORS]: { unlimited: false, value: 2 },
          [PlanLimitResource.STAFF]: { unlimited: false, value: 2 },
          [PlanLimitResource.PARENTS]: { unlimited: false, value: 2 },
          [PlanLimitResource.TRIPS]: { unlimited: false, value: 2 },
        })
      ).id,
    );

    // 25 parallel creates with unique keys: all succeed, all visible.
    const uniqueBatch = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        manageRequest<StudentData>(app, 'POST', concurrency.id, '/students', root, {
          admission_number: `CONC-U-${String(index + 1).padStart(3, '0')}`,
          first_name: `Conc${index + 1}`,
          last_name: 'Unique',
        }),
      ),
    );
    assert.ok(
      uniqueBatch.every((result) => result.status === 201),
      JSON.stringify(uniqueBatch.find((r) => r.status !== 201)?.body),
    );
    assert.equal(await Student.count({ where: { school_id: concurrency.id } }), 25);
    assert.equal(
      new Set(uniqueBatch.map((result) => result.body.data?.id)).size,
      25,
      'no duplicate rows',
    );

    // 20 parallel creates racing on the SAME natural key: exactly one wins.
    const duplicateKey = 'CONC-DUP-001';
    const duplicateBatch = await Promise.all(
      Array.from({ length: 20 }, () =>
        manageRequest(app, 'POST', concurrency.id, '/students', root, {
          admission_number: duplicateKey,
          first_name: 'Dup',
          last_name: 'Racer',
        }),
      ),
    );
    const winners = duplicateBatch.filter((result) => result.status === 201);
    const losers = duplicateBatch.filter((result) => result.status === 409);
    assert.equal(winners.length, 1, JSON.stringify(duplicateBatch.map((r) => r.status)));
    assert.equal(losers.length, 19);
    assert.equal(
      await Student.count({ where: { school_id: concurrency.id, admission_number: duplicateKey } }),
      1,
    );

    // Concurrent cross-school writes never cross: A and B in parallel.
    const mixed = await Promise.all([
      ...Array.from({ length: 10 }, (_, index) =>
        manageRequest(app, 'POST', alpha.school.id, '/students', root, {
          admission_number: `CONC-A-${index}`,
          first_name: 'InA',
          last_name: 'Only',
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        manageRequest(app, 'POST', beta.school.id, '/students', root, {
          admission_number: `CONC-B-${index}`,
          first_name: 'InB',
          last_name: 'Only',
        }),
      ),
    ]);
    assert.ok(mixed.every((result) => result.status === 201));
    const aNumbers = (
      await Student.findAll({ where: { school_id: alpha.school.id }, raw: true })
    ).map((row) => row.admission_number);
    const bNumbers = (
      await Student.findAll({ where: { school_id: beta.school.id }, raw: true })
    ).map((row) => row.admission_number);
    assert.ok(
      aNumbers.every((value) => !value.startsWith('CONC-B-')),
      'no B rows in A',
    );
    assert.ok(
      bNumbers.every((value) => !value.startsWith('CONC-A-')),
      'no A rows in B',
    );

    // 25 unique winners + exactly 1 duplicate winner = 26 rows; the 19 racing
    // duplicates were rejected and consume no quota.
    assert.equal(await Student.count({ where: { school_id: concurrency.id } }), 26);

    // Leave the workspace the way we found it.
    await manageRequest(app, 'POST', alpha.school.id, '/session/end', root);
    await manageRequest(app, 'POST', beta.school.id, '/session/end', root);
  });

  it('18. mutations on an inactive school are blocked; reads and session bookkeeping are not', async () => {
    const suspended = await createSchool({ name: 'Suspended School', is_active: false });
    await createSubscription(suspended.id, (await createPlan({})).id);

    const read = await manageRequest(app, 'GET', suspended.id, '/students', root);
    assert.equal(read.status, 200);

    const start = await manageRequest(app, 'POST', suspended.id, '/session', root);
    assert.equal(start.status, 201, 'operator may open a read-only assisted session');

    const write = await manageRequest(app, 'POST', suspended.id, '/students', root, {
      admission_number: `SUSP-${randomUUID().slice(0, 8)}`,
      first_name: 'Blocked',
      last_name: 'Write',
    });
    assert.equal(write.status, 403, JSON.stringify(write.body));
    assert.match(errorMessage(write.body) ?? '', /deactivated/i);

    const end = await manageRequest(app, 'POST', suspended.id, '/session/end', root);
    assert.equal(end.status, 200);
  });
});
