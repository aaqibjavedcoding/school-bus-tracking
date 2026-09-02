import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiClient } from '@school-bus-tracking/api-client';
import { ImportJobStatus, ImportMode, ImportModule } from '@school-bus-tracking/shared-types';

/**
 * Regression for the Import UI error:
 *
 *   Unable to load
 *   Unexpected token '-', "------WebK"... is not valid JSON
 *
 * `validateImport` / `commitImport` send `FormData`, but `ApiClient.request`
 * used to merge the default `Content-Type: application/json` onto that
 * request. The browser still serialised a multipart body
 * (`------WebKitFormBoundary…`); Nest's JSON parser then `JSON.parse`d it
 * and the wizard surfaced the parse error instead of the validation result.
 *
 * These tests drive the real `fetch` + `FormData` path against a tiny HTTP
 * stand-in for the Nest import endpoints so we inspect the actual
 * Content-Type / body the client puts on the wire — not a mocked header map.
 */

interface CapturedRequest {
  method: string;
  url: string;
  contentType: string;
  accept: string;
  authorization: string;
  bodyStart: string;
  jsonParsed: boolean;
  jsonParseError: string | null;
}

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ERROR_WORKBOOK = Buffer.from('XLSX-ERROR-WORKBOOK');

function jsonEnvelope(data: unknown, status = 200): { status: number; body: string; type: string } {
  return {
    status,
    type: 'application/json',
    body: JSON.stringify({ success: true, data, timestamp: new Date().toISOString() }),
  };
}

function validResult() {
  return {
    job_id: JOB_ID,
    module: ImportModule.STUDENTS,
    mode: ImportMode.CREATE,
    file_name: 'students.csv',
    summary: {
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      duplicate_rows_in_file: 0,
      existing_records: 0,
      rows_to_create: 1,
      rows_to_update: 0,
      rows_to_skip: 0,
    },
    preview: [{ row_number: 1, status: 'VALID', label: 'Ada Lovelace (ST001)', issues: [] }],
    preview_truncated: false,
    unknown_columns: [],
    missing_columns: [],
    can_import: true,
    has_error_file: false,
  };
}

function invalidResult() {
  return {
    ...validResult(),
    file_name: 'invalid-students.csv',
    summary: {
      total_rows: 1,
      valid_rows: 0,
      invalid_rows: 1,
      duplicate_rows_in_file: 0,
      existing_records: 0,
      rows_to_create: 0,
      rows_to_update: 0,
      rows_to_skip: 1,
    },
    preview: [
      {
        row_number: 1,
        status: 'INVALID',
        label: 'ST001',
        issues: [{ column: 'Last Name', message: 'Last Name is required' }],
      },
    ],
    can_import: false,
    has_error_file: true,
  };
}

function startImportStandIn(): Promise<{
  server: http.Server;
  baseUrl: string;
  captured: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const contentType = String(req.headers['content-type'] ?? '');
      let jsonParsed = false;
      let jsonParseError: string | null = null;
      if (contentType.toLowerCase().includes('application/json') && raw.length > 0) {
        try {
          JSON.parse(raw.toString('utf8'));
          jsonParsed = true;
        } catch (error) {
          jsonParseError = error instanceof Error ? error.message : String(error);
        }
      }

      captured.push({
        method: req.method ?? 'GET',
        url: req.url ?? '',
        contentType,
        accept: String(req.headers.accept ?? ''),
        authorization: String(req.headers.authorization ?? ''),
        bodyStart: raw.subarray(0, 160).toString('utf8'),
        jsonParsed,
        jsonParseError,
      });

      const url = req.url ?? '';
      const method = (req.method ?? 'GET').toUpperCase();

      // Mimic Nest/Express json(): labelled-as-JSON multipart is a 400 whose
      // message is the JSON.parse error — exactly what the Import UI showed.
      if (jsonParseError) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: { code: 'Bad Request', message: jsonParseError },
            timestamp: new Date().toISOString(),
          }),
        );
        return;
      }

      if (method === 'GET' && /\/imports\/history\/[^/]+\/error-file/.test(url)) {
        res.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="students_import_errors.xlsx"',
          'content-length': String(ERROR_WORKBOOK.length),
        });
        res.end(ERROR_WORKBOOK);
        return;
      }

      if (method === 'POST' && /\/imports\/[^/]+\/(validate|commit)/.test(url)) {
        if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'Bad Request',
                message: `Expected multipart/form-data, got ${contentType || '(empty)'}`,
              },
            }),
          );
          return;
        }

        const isCommit = url.includes('/commit');
        const isInvalid = raw.toString('utf8').includes('invalid-students');
        const data = isInvalid
          ? invalidResult()
          : isCommit
            ? {
                ...validResult(),
                status: ImportJobStatus.COMPLETED,
                created_count: 1,
                updated_count: 0,
                skipped_count: 0,
                failure_reason: null,
              }
            : validResult();
        const payload = jsonEnvelope(data);
        res.writeHead(payload.status, { 'content-type': payload.type });
        res.end(payload.body);
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ success: true, data: { ok: true }, timestamp: new Date().toISOString() }),
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/api/v1`, captured });
    });
  });
}

function spreadsheet(name: string): File {
  const csv = 'Admission Number,First Name,Last Name\nST001,Ada,Lovelace\n';
  return new File([csv], name, { type: 'text/csv' });
}

describe('ApiClient import multipart upload (regression for ------WebK JSON parse)', () => {
  let server: http.Server;
  let baseUrl: string;
  let captured: CapturedRequest[];
  let client: ApiClient;

  before(async () => {
    ({ server, baseUrl, captured } = await startImportStandIn());
    client = new ApiClient({
      baseUrl,
      getAccessToken: () => 'test-jwt',
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('does not label a FormData import as application/json (the ------WebK failure)', async () => {
    captured.length = 0;

    const envelope = await client.validateImport(
      ImportModule.STUDENTS,
      spreadsheet('students.csv'),
      ImportMode.CREATE,
      'students.csv',
    );

    assert.equal(captured.length, 1);
    const request = captured[0];
    assert.equal(request.method, 'POST');
    assert.match(request.url, /\/imports\/students\/validate\?mode=create/);
    assert.match(request.contentType, /^multipart\/form-data; *boundary=/i);
    assert.equal(request.contentType.toLowerCase().includes('application/json'), false);
    assert.match(request.bodyStart, /^--/);
    assert.equal(request.jsonParsed, false);
    assert.equal(request.jsonParseError, null);
    assert.equal(request.authorization, 'Bearer test-jwt');
    assert.match(request.accept, /application\/json/);

    assert.equal(envelope.success, true);
    assert.equal(envelope.data?.can_import, true);
    assert.equal(envelope.data?.summary.valid_rows, 1);
    assert.equal(envelope.data?.summary.invalid_rows, 0);
  });

  it('returns validation JSON (valid/invalid counts) for a file with row errors — not a workbook', async () => {
    captured.length = 0;

    const envelope = await client.validateImport(
      ImportModule.STUDENTS,
      spreadsheet('invalid-students.csv'),
      ImportMode.CREATE,
      'invalid-students.csv',
    );

    assert.match(captured[0].contentType, /^multipart\/form-data/i);
    assert.equal(envelope.data?.can_import, false);
    assert.equal(envelope.data?.has_error_file, true);
    assert.equal(envelope.data?.summary.valid_rows, 0);
    assert.equal(envelope.data?.summary.invalid_rows, 1);
    assert.equal(envelope.data?.job_id, JOB_ID);
  });

  it('sends commit as multipart too and still parses the JSON result', async () => {
    captured.length = 0;

    const envelope = await client.commitImport(
      ImportModule.STUDENTS,
      spreadsheet('students.csv'),
      ImportMode.CREATE,
      'students.csv',
    );

    assert.match(captured[0].contentType, /^multipart\/form-data/i);
    assert.equal(captured[0].contentType.toLowerCase().includes('application/json'), false);
    assert.equal(envelope.data?.status, ImportJobStatus.COMPLETED);
    assert.equal(envelope.data?.created_count, 1);
  });

  it('downloads the error workbook as a blob instead of calling response.json()', async () => {
    captured.length = 0;

    const file = await client.downloadImportErrorFile(JOB_ID);

    assert.equal(file.fileName, 'students_import_errors.xlsx');
    assert.equal(
      Buffer.from(await file.blob.arrayBuffer()).toString('utf8'),
      'XLSX-ERROR-WORKBOOK',
    );
  });

  it('still sends application/json for ordinary JSON POST bodies', async () => {
    captured.length = 0;

    await client.createStudent({
      admission_number: 'ST001',
      first_name: 'Ada',
      last_name: 'Lovelace',
    });

    assert.equal(captured[0].contentType, 'application/json');
    assert.equal(captured[0].jsonParsed, true);
  });

  it('documents the original failure: JSON Content-Type + multipart body is unparseable', async () => {
    captured.length = 0;
    const form = new FormData();
    form.append('file', spreadsheet('students.csv'), 'students.csv');

    const response = await fetch(`${baseUrl}/imports/students/validate?mode=create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: form,
    });
    const body = (await response.json()) as { error?: { message?: string } };

    assert.equal(response.status, 400);
    assert.equal(typeof body.error?.message, 'string');
    // Node says "No number after minus sign…"; browsers say
    // `Unexpected token '-', "------WebK"... is not valid JSON`. Both are
    // JSON.parse choking on a multipart boundary.
    assert.match(String(body.error?.message), /JSON|minus sign/i);
    assert.match(captured[0].bodyStart, /^----/);
  });
});
