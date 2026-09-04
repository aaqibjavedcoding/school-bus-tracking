import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type {
  AdminSchoolAdminCreateRequest,
  AdminSchoolCreateRequest,
  AdminSchoolUpdateRequest,
} from '@school-bus-tracking/shared-types';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

const createBody: AdminSchoolCreateRequest = {
  school: { name: 'Lincoln High School', code: 'lincoln-high', city: 'Springfield' },
  admin: {
    first_name: 'Alicia',
    last_name: 'Adams',
    email: 'admin@lincoln.test',
    password: 'correct-horse',
  },
};

const updateBody: AdminSchoolUpdateRequest = { name: 'Lincoln High', city: 'Springfield' };

const adminBody: AdminSchoolAdminCreateRequest = {
  first_name: 'Bob',
  last_name: 'Baker',
  email: 'bob@lincoln.test',
  password: 'correct-horse',
};

describe('ApiClient Super Admin platform methods', () => {
  it('targets /admin/* endpoints with the correct HTTP verbs and never sends a tenant claim', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      });
      return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });

      await client.getAdminDashboard();
      await client.createAdminSchool(createBody);
      await client.listAdminSchools({
        page: 2,
        limit: 10,
        search: 'lin',
        status: 'inactive',
        sort: 'name',
        order: 'asc',
      });
      await client.getAdminSchool(SCHOOL_ID);
      await client.updateAdminSchool(SCHOOL_ID, updateBody);
      await client.activateAdminSchool(SCHOOL_ID);
      await client.deactivateAdminSchool(SCHOOL_ID);
      await client.listSchoolAdmins(SCHOOL_ID, { page: 1, limit: 20 });
      await client.createSchoolAdmin(SCHOOL_ID, adminBody);
      await client.updateSchoolAdmin(SCHOOL_ID, ADMIN_ID, { first_name: 'Robert' });
      await client.setSchoolAdminActive(SCHOOL_ID, ADMIN_ID, false);
      await client.setSchoolAdminActive(SCHOOL_ID, ADMIN_ID, true);
      await client.resetSchoolAdminPassword(SCHOOL_ID, ADMIN_ID, { password: 'new-password-123' });

      const [
        dashboard,
        create,
        list,
        get,
        update,
        activate,
        deactivate,
        admins,
        adminCreate,
        adminUpdate,
        adminDeactivate,
        adminActivate,
        resetPassword,
      ] = requests;

      assert.equal(dashboard.method, 'GET');
      assert.equal(dashboard.url, 'https://api.example.test/api/v1/admin/dashboard');

      assert.equal(create.method, 'POST');
      assert.equal(create.url, 'https://api.example.test/api/v1/admin/schools');
      // The body contains the nested school/admin payload but never a
      // client-supplied JWT role or token tenant claim.
      assert.ok(create.body?.includes('"code":"lincoln-high"'));
      assert.ok(create.body?.includes('"password"'));

      assert.equal(list.method, 'GET');
      assert.ok(list.url.includes('/admin/schools?'));
      assert.ok(list.url.includes('status=inactive'));
      assert.ok(list.url.includes('sort=name'));
      assert.ok(list.url.includes('search=lin'));

      assert.equal(get.url, `https://api.example.test/api/v1/admin/schools/${SCHOOL_ID}`);
      assert.equal(update.method, 'PATCH');
      assert.equal(update.url, `https://api.example.test/api/v1/admin/schools/${SCHOOL_ID}`);

      assert.equal(activate.method, 'POST');
      assert.ok(activate.url.endsWith(`/admin/schools/${SCHOOL_ID}/activate`));
      assert.equal(deactivate.method, 'POST');
      assert.ok(deactivate.url.endsWith(`/admin/schools/${SCHOOL_ID}/deactivate`));

      assert.equal(admins.method, 'GET');
      assert.ok(admins.url.includes(`/admin/schools/${SCHOOL_ID}/admins`));

      assert.equal(adminCreate.method, 'POST');
      assert.ok(adminCreate.url.endsWith(`/admin/schools/${SCHOOL_ID}/admins`));
      assert.equal(adminUpdate.method, 'PATCH');
      assert.ok(adminUpdate.url.endsWith(`/admin/schools/${SCHOOL_ID}/admins/${ADMIN_ID}`));

      assert.equal(adminDeactivate.method, 'POST');
      assert.ok(adminDeactivate.url.endsWith(`/admins/${ADMIN_ID}/deactivate`));
      assert.equal(adminActivate.method, 'POST');
      assert.ok(adminActivate.url.endsWith(`/admins/${ADMIN_ID}/activate`));

      assert.equal(resetPassword.method, 'POST');
      assert.ok(resetPassword.url.endsWith(`/admins/${ADMIN_ID}/reset-password`));
      assert.ok(resetPassword.body?.includes('"password":"new-password-123"'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
