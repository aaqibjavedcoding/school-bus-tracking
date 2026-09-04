import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '@school-bus-tracking/api-client';
import { ImportMode, ImportModule } from '@school-bus-tracking/shared-types';

/**
 * Regression: Import wizard showed
 * `Unable to load` / `Unexpected token '-', "------WebK"... is not valid JSON`.
 *
 * The client defaulted every request to `Content-Type: application/json`.
 * `validateImport` sends FormData, so the browser still wrote a multipart
 * body (`------WebKitFormBoundary…`) while advertising JSON. Nest parsed
 * that body as JSON and the wizard rendered the parse error.
 */
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = (init.headers || {}) as Record<string, string>;
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

describe('web import upload Content-Type', () => {
  it('does not send Content-Type: application/json with the Excel FormData body', async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      captured = init;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            job_id: 'job-1',
            can_import: true,
            has_error_file: false,
            summary: { valid_rows: 1, invalid_rows: 0 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = new ApiClient({
      baseUrl: '/api/v1',
      getAccessToken: () => 'jwt',
    });
    const file = new File(['Admission Number\nST001\n'], 'students.csv', { type: 'text/csv' });

    const envelope = await client.validateImport(
      ImportModule.STUDENTS,
      file,
      ImportMode.CREATE,
      file.name,
    );

    assert.ok(captured, 'validateImport must call fetch');
    assert.equal(captured.body instanceof FormData, true);
    assert.equal(
      headerOf(captured, 'Content-Type'),
      undefined,
      'Content-Type must be omitted so the runtime can set multipart/form-data; boundary=…',
    );
    assert.equal(headerOf(captured, 'Accept'), 'application/json');
    assert.equal(headerOf(captured, 'Authorization'), 'Bearer jwt');
    assert.equal(envelope.data?.can_import, true);
  });

  it('still sends application/json for ordinary JSON POST bodies', async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      captured = init;
      return new Response(JSON.stringify({ success: true, data: { id: '1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ApiClient({ baseUrl: '/api/v1', getAccessToken: () => 'jwt' });
    await client.createStudent({
      admission_number: 'ST001',
      first_name: 'Ada',
      last_name: 'Lovelace',
    });

    assert.equal(headerOf(captured ?? {}, 'Content-Type'), 'application/json');
  });
});
