import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient, resolveManagedSchoolPath } from '@school-bus-tracking/api-client';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '33333333-1111-4111-8111-111111111111';
const PARENT_ID = '44444444-1111-4111-8111-111111111111';

describe('resolveManagedSchoolPath', () => {
  it('remaps every supported tenant resource onto the managed surface', () => {
    const managed = (endpoint: string) => resolveManagedSchoolPath(SCHOOL_ID, endpoint);

    assert.equal(managed('/students'), `/admin/schools/${SCHOOL_ID}/manage/students`);
    assert.equal(
      managed(`/students/${STUDENT_ID}`),
      `/admin/schools/${SCHOOL_ID}/manage/students/${STUDENT_ID}`,
    );
    assert.equal(
      managed(`/students/${STUDENT_ID}/guardians/${PARENT_ID}`),
      `/admin/schools/${SCHOOL_ID}/manage/students/${STUDENT_ID}/guardians/${PARENT_ID}`,
    );
    assert.equal(
      managed('/parents?search=ayaan'),
      `/admin/schools/${SCHOOL_ID}/manage/parents?search=ayaan`,
    );
    assert.equal(
      managed(`/parents/${PARENT_ID}/students/${STUDENT_ID}`),
      `/admin/schools/${SCHOOL_ID}/manage/parents/${PARENT_ID}/students/${STUDENT_ID}`,
    );
    assert.equal(managed('/buses'), `/admin/schools/${SCHOOL_ID}/manage/buses`);
    assert.equal(
      managed(`/routes/${STUDENT_ID}/details`),
      `/admin/schools/${SCHOOL_ID}/manage/routes/${STUDENT_ID}/details`,
    );
    assert.equal(
      managed('/stops?route_id=x'),
      `/admin/schools/${SCHOOL_ID}/manage/stops?route_id=x`,
    );
    assert.equal(managed('/drivers'), `/admin/schools/${SCHOOL_ID}/manage/drivers`);
    assert.equal(managed('/conductors'), `/admin/schools/${SCHOOL_ID}/manage/conductors`);
    assert.equal(managed('/assignments'), `/admin/schools/${SCHOOL_ID}/manage/assignments`);
    assert.equal(
      managed('/route-assignments'),
      `/admin/schools/${SCHOOL_ID}/manage/route-assignments`,
    );
    assert.equal(managed('/imports/modules'), `/admin/schools/${SCHOOL_ID}/manage/imports/modules`);
    assert.equal(managed('/imports/history'), `/admin/schools/${SCHOOL_ID}/manage/imports/history`);
    assert.equal(
      managed(`/imports/history/${STUDENT_ID}/error-file`),
      `/admin/schools/${SCHOOL_ID}/manage/imports/history/${STUDENT_ID}/error-file`,
    );
    assert.equal(
      managed('/imports/students/template?format=csv'),
      `/admin/schools/${SCHOOL_ID}/manage/imports/students/template?format=csv`,
    );
    assert.equal(
      managed('/imports/students/commit?mode=create'),
      `/admin/schools/${SCHOOL_ID}/manage/imports/students/commit?mode=create`,
    );
    assert.equal(managed('/exports'), `/admin/schools/${SCHOOL_ID}/manage/exports`);
    assert.equal(
      managed('/exports/students?format=xlsx'),
      `/admin/schools/${SCHOOL_ID}/manage/exports/students?format=xlsx`,
    );
    assert.equal(managed('/reports'), `/admin/schools/${SCHOOL_ID}/manage/reports`);
    assert.equal(
      managed('/reports/transport_coverage/export'),
      `/admin/schools/${SCHOOL_ID}/manage/reports/transport_coverage/export`,
    );
  });

  it('leaves everything outside the assisted allowlist untouched', () => {
    const managed = (endpoint: string) => resolveManagedSchoolPath(SCHOOL_ID, endpoint);

    // Explicitly restricted or out-of-scope surfaces must never be redirected.
    assert.equal(managed('/trips'), null);
    assert.equal(managed(`/trips/${STUDENT_ID}`), null);
    assert.equal(managed('/emergencies'), null);
    assert.equal(managed('/notifications'), null);
    assert.equal(managed(`/drivers/${STUDENT_ID}/documents`), null);
    assert.equal(managed('/attendance'), null);
    // Parent self-service must never be reachable through the managed context.
    assert.equal(managed('/parents/me/students'), null);
    // Platform + auth calls are never rewritten.
    assert.equal(managed('/admin/schools'), null);
    assert.equal(managed('/auth/login'), null);
    assert.equal(managed('/health'), null);
    // Defensive input handling.
    assert.equal(resolveManagedSchoolPath('', '/students'), null);
    assert.equal(resolveManagedSchoolPath(SCHOOL_ID, 'students'), null);
  });
});

describe('ApiClient managed-school context', () => {
  const requests: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    requests.length = 0;
  });

  function installFetchStub(): void {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            items: [],
            meta: {
              page: 1,
              limit: 20,
              total: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPreviousPage: false,
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;
  }

  it('routes tenant calls to /admin/schools/:id/manage/* only while the context is active', async () => {
    installFetchStub();
    let managedSchoolId: string | null = null;
    const client = new ApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      getAccessToken: () => 'token',
      resolveManagedSchoolId: () => managedSchoolId,
    });

    // Without the context: plain tenant endpoints.
    await client.listStudents({ page: 1 });
    assert.ok(requests.at(-1)?.url.endsWith('/api/v1/students?page=1'), requests.at(-1)?.url);

    // Context active: the same call lands on the guarded managed surface.
    managedSchoolId = SCHOOL_ID;
    await client.listStudents({ page: 2, search: 'ayaan' });
    assert.equal(
      requests.at(-1)?.url,
      `https://api.example.test/api/v1/admin/schools/${SCHOOL_ID}/manage/students?page=2&search=ayaan`,
      requests.at(-1)?.url,
    );

    await client.createStudent({
      admission_number: 'ST-1',
      first_name: 'Ayaan',
      last_name: 'Khan',
    } as never);
    assert.ok(requests.at(-1)?.url.endsWith(`/manage/students`), requests.at(-1)?.url);
    assert.equal(requests.at(-1)?.method, 'POST');

    await client.downloadExport('students' as never, { format: 'csv' } as never);
    assert.ok(
      requests.at(-1)?.url.endsWith(`/manage/exports/students?format=csv`),
      requests.at(-1)?.url,
    );

    // Platform + auth calls are unaffected by the active context.
    await client.getAdminSchool(SCHOOL_ID);
    assert.ok(
      requests.at(-1)?.url.endsWith(`/api/v1/admin/schools/${SCHOOL_ID}`) &&
        !requests.at(-1)?.url.includes('/manage/'),
      requests.at(-1)?.url,
    );

    // Session lifecycle methods target the session endpoints directly.
    await client.startManagedSchoolSession(SCHOOL_ID);
    assert.ok(requests.at(-1)?.url.endsWith(`/manage/session`), requests.at(-1)?.url);
    await client.getManagedSchoolSession(SCHOOL_ID);
    assert.ok(requests.at(-1)?.url.endsWith(`/manage/session/current`), requests.at(-1)?.url);
    await client.endManagedSchoolSession(SCHOOL_ID);
    assert.ok(requests.at(-1)?.url.endsWith(`/manage/session/end`), requests.at(-1)?.url);

    // Context off again: back to the plain tenant surface (and out-of-scope
    // resources were never remapped even while it was on).
    managedSchoolId = null;
    await client.listStudents({ page: 1 });
    assert.ok(requests.at(-1)?.url.endsWith('/api/v1/students?page=1'), requests.at(-1)?.url);
  });
});
