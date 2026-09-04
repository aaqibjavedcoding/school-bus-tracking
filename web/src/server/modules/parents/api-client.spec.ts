import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import type { ParentCreateRequest } from '@school-bus-tracking/shared-types';

const parentBody: ParentCreateRequest = {
  first_name: 'Alicia',
  last_name: 'Adams',
  email: 'parent@example.org',
  password: 'correct-horse-battery',
};

describe('ApiClient parent and relationship methods', () => {
  it('uses tenant-free parent account and relationship endpoints', async () => {
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
      await client.createParent(parentBody);
      await client.listParents({ page: 2, limit: 10, search: 'Alicia' });
      await client.linkParentToStudent('parent-id', {
        student_id: 'student-id',
        relationship: 'Mother',
        can_pick_up: true,
      });
      await client.listParentStudents('parent-id');
      await client.updateParentStudentRelationship('parent-id', 'student-id', {
        can_pick_up: false,
      });
      await client.unlinkParentFromStudent('parent-id', 'student-id');
      await client.listMyStudents();

      assert.equal(requests[0].url, 'https://api.example.test/api/v1/parents');
      assert.equal(requests[0].method, 'POST');
      assert.ok(!requests[0].body?.includes('school_id'));
      assert.ok(requests.every((request) => !request.url.includes('school_id=')));
      assert.equal(requests[2].url, 'https://api.example.test/api/v1/parents/parent-id/students');
      assert.equal(
        requests[5].url,
        'https://api.example.test/api/v1/parents/parent-id/students/student-id',
      );
      assert.equal(requests[6].url, 'https://api.example.test/api/v1/parents/me/students');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('supports student-centred guardian methods', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ success: true, data: { items: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const client = new ApiClient({ baseUrl: 'https://api.example.test/api/v1' });
      await client.createStudentGuardian('student-id', {
        parent_id: 'parent-id',
        relationship: 'Guardian',
      });
      await client.listStudentGuardians('student-id');
      await client.updateStudentGuardian('student-id', 'parent-id', { is_primary: true });
      await client.deleteStudentGuardian('student-id', 'parent-id');
      assert.deepEqual(urls, [
        'https://api.example.test/api/v1/students/student-id/guardians',
        'https://api.example.test/api/v1/students/student-id/guardians',
        'https://api.example.test/api/v1/students/student-id/guardians/parent-id',
        'https://api.example.test/api/v1/students/student-id/guardians/parent-id',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
