import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ConflictException } from '../../../framework';
import { UniqueConstraintError, ValidationError as SequelizeValidationError } from 'sequelize';
import {
  ImportJobStatus,
  ImportMode,
  ImportModule,
  ImportRowStatus,
  RouteAssignmentRole,
  UserRole,
} from '@school-bus-tracking/shared-types';
import type { PlanLimitsService } from '../../../common/plan-limits';
import type { AuditService } from '../../audit';
import { AUDIT_ACTIONS } from '../../audit';
import { ImportService, type UploadedImportFile } from './import.service';

/**
 * Import engine tests.
 *
 * Everything is exercised through the real students definition and the real
 * shared Zod row schema — stubbing the definition would only prove the stub
 * works. The Sequelize models are replaced by in-memory doubles so the suite
 * stays a fast unit test while still driving the genuine code path.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ACTOR = { schoolId: SCHOOL_A, userId: ADMIN_A };

const STUDENT_HEADERS = [
  'Admission Number',
  'First Name',
  'Last Name',
  'Date Of Birth',
  'Gender',
  'Grade',
  'Route Code',
  'Home Stop',
  'Emergency Contact Name',
  'Emergency Contact Phone',
  'Medical Notes',
  'Active',
  'Parent Email',
  'Parent Relationship',
];

/** Builds a CSV upload from a header row plus data rows. */
function csvFile(headers: string[], rows: string[][], name = 'students.csv'): UploadedImportFile {
  const escape = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','));
  return { originalName: name, buffer: Buffer.from(lines.join('\r\n'), 'utf8') };
}

/** A students CSV built from partial rows keyed by header. */
function studentFile(rows: Array<Record<string, string>>, name = 'students.csv') {
  return csvFile(
    STUDENT_HEADERS,
    rows.map((row) => STUDENT_HEADERS.map((header) => row[header] ?? '')),
    name,
  );
}

interface StubRow {
  id: string;
  school_id: string;
  [key: string]: unknown;
}

/**
 * Minimal in-memory stand-in for a Sequelize model.
 *
 * `findAll` honours `school_id` and `Op.in` because tenant scoping is precisely
 * what several of these tests are asserting on.
 */
class StubModel {
  public readonly created: Array<Record<string, unknown>> = [];
  public readonly updated: Array<{
    values: Record<string, unknown>;
    where: Record<string, unknown>;
  }> = [];
  public failNextBulkCreate: Error | null = null;

  constructor(public rows: StubRow[] = []) {}

  async findAll(options: { where?: Record<string, unknown> } = {}): Promise<StubRow[]> {
    const where = options.where ?? {};
    return this.rows.filter((row) =>
      Object.entries(where).every(([key, condition]) => {
        const value = row[key];
        if (condition && typeof condition === 'object') {
          const inList = (condition as Record<symbol, unknown>)[
            Object.getOwnPropertySymbols(condition).find(
              (symbol) => symbol.toString() === 'Symbol(in)',
            ) as symbol
          ];
          if (Array.isArray(inList)) {
            return inList.some(
              (candidate) => String(candidate).toLowerCase() === String(value).toLowerCase(),
            );
          }
          return true;
        }
        return value === condition;
      }),
    );
  }

  async bulkCreate(records: Array<Record<string, unknown>>): Promise<unknown> {
    if (this.failNextBulkCreate) {
      const error = this.failNextBulkCreate;
      this.failNextBulkCreate = null;
      throw error;
    }
    this.created.push(...records);
    return records;
  }

  async update(
    values: Record<string, unknown>,
    options: { where: Record<string, unknown> },
  ): Promise<unknown> {
    this.updated.push({ values, where: options.where });
    return [1];
  }

  async create(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    const record = { id: `row-${this.rows.length + 1}`, ...values };
    this.rows.push(record as StubRow);
    return record;
  }
}

interface Harness {
  service: ImportService;
  students: StubModel;
  guardians: StubModel;
  users: StubModel;
  buses: StubModel;
  routes: StubModel;
  stops: StubModel;
  assignments: StubModel;
  importJobs: StubModel;
  auditEntries: Array<Record<string, unknown>>;
  bulkLimitCalls: Array<{ schoolId: string; additional: number }>;
}

function makeHarness(
  options: {
    students?: StubRow[];
    users?: StubRow[];
    buses?: StubRow[];
    routes?: StubRow[];
    stops?: StubRow[];
    assignments?: StubRow[];
    planLimitError?: Error;
  } = {},
): Harness {
  const students = new StubModel(options.students ?? []);
  const guardians = new StubModel();
  const users = new StubModel(options.users ?? []);
  const buses = new StubModel(options.buses ?? []);
  const routes = new StubModel(options.routes ?? []);
  const stops = new StubModel(options.stops ?? []);
  const assignments = new StubModel(options.assignments ?? []);
  const importJobs = new StubModel();

  const auditEntries: Array<Record<string, unknown>> = [];
  const bulkLimitCalls: Array<{ schoolId: string; additional: number }> = [];

  const planLimits = {
    async runWithinBulkLimit(
      schoolId: string,
      _resources: unknown,
      additional: number,
      work: (transaction?: unknown) => Promise<unknown>,
    ) {
      bulkLimitCalls.push({ schoolId, additional });
      if (options.planLimitError) {
        throw options.planLimitError;
      }
      return work(undefined);
    },
  } as unknown as PlanLimitsService;

  const audit = {
    async log(entry: Record<string, unknown>) {
      auditEntries.push(entry);
    },
  } as unknown as AuditService;

  const service = new ImportService(
    students as never,
    guardians as never,
    users as never,
    buses as never,
    routes as never,
    stops as never,
    assignments as never,
    importJobs as never,
    planLimits,
    audit,
    null,
  );

  return {
    service,
    students,
    guardians,
    users,
    buses,
    routes,
    stops,
    assignments,
    importJobs,
    auditEntries,
    bulkLimitCalls,
  };
}

const ROUTE_NORTH: StubRow = {
  id: 'route-north',
  school_id: SCHOOL_A,
  code: 'NORTH-AM',
  name: 'North morning',
};
const STOP_MAPLE: StubRow = {
  id: 'stop-maple',
  school_id: SCHOOL_A,
  route_id: 'route-north',
  name: 'Maple St',
};

let harness: Harness;
beforeEach(() => {
  harness = makeHarness();
});

describe('ImportService.validate — file-level problems', () => {
  it('rejects a file whose required columns are missing', async () => {
    const file = csvFile(['Admission Number', 'First Name'], [['ST001', 'Ada']]);

    await assert.rejects(
      () => harness.service.validate(ACTOR, ImportModule.STUDENTS, ImportMode.CREATE, file),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(error.message, /missing required column/i);
        assert.match(error.message, /Last Name/);
        return true;
      },
    );
  });

  it('rejects a file with a header row but no data rows', async () => {
    await assert.rejects(
      () =>
        harness.service.validate(ACTOR, ImportModule.STUDENTS, ImportMode.CREATE, studentFile([])),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(error.message, /empty|no rows|does not contain/i);
        return true;
      },
    );
  });

  it('rejects a file that is not a spreadsheet', async () => {
    await assert.rejects(
      () =>
        harness.service.validate(ACTOR, ImportModule.STUDENTS, ImportMode.CREATE, {
          originalName: 'students.xlsx',
          buffer: Buffer.from('this is definitely not a workbook'),
        }),
      BadRequestException,
    );
  });

  it('rejects a file with more rows than the module allows', async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({
      'Admission Number': `ST${index}`,
      'First Name': 'Ada',
      'Last Name': 'Lovelace',
    }));

    await assert.rejects(
      () =>
        harness.service.validate(
          ACTOR,
          ImportModule.STUDENTS,
          ImportMode.CREATE,
          studentFile(rows),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(error.message, /more than 5000 rows/);
        return true;
      },
    );
  });

  it('reports unknown columns instead of importing them', async () => {
    const file = csvFile(
      [...STUDENT_HEADERS, 'Secret Internal Score'],
      [['ST001', 'Ada', 'Lovelace', '', '', '', '', '', '', '', '', '', '', '', '99']],
    );

    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      file,
    );

    assert.deepEqual(result.unknown_columns, ['Secret Internal Score']);
    assert.equal(result.summary.valid_rows, 1);
  });
});

describe('ImportService.validate — row analysis', () => {
  it('accepts a clean file and reports every counter', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        { 'Admission Number': 'ST002', 'First Name': 'Grace', 'Last Name': 'Hopper' },
      ]),
    );

    assert.deepEqual(result.summary, {
      total_rows: 2,
      valid_rows: 2,
      invalid_rows: 0,
      duplicate_rows_in_file: 0,
      existing_records: 0,
      rows_to_create: 2,
      rows_to_update: 0,
      rows_to_skip: 0,
    });
    assert.equal(result.can_import, true);
    assert.equal(result.has_error_file, false);
    assert.equal(result.mode, ImportMode.CREATE);
  });

  it('writes nothing during validation', async () => {
    await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    assert.equal(harness.students.created.length, 0);
    assert.equal(harness.students.updated.length, 0);
  });

  it('flags a row missing a required field, naming the spreadsheet header', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada' }]),
    );

    assert.equal(result.summary.invalid_rows, 1);
    assert.equal(result.can_import, false);
    const row = result.preview[0];
    assert.equal(row.status, ImportRowStatus.INVALID);
    // The admin sees "Last Name", not the internal field key `last_name`.
    assert.ok(row.issues.some((issue) => issue.column === 'Last Name'));
  });

  it('collects every problem on a row rather than stopping at the first', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        {
          'Admission Number': 'ST001',
          'First Name': 'Ada',
          'Last Name': 'Lovelace',
          'Date Of Birth': 'not-a-date',
          Gender: 'ROBOT',
          'Emergency Contact Phone': 'nope',
        },
      ]),
    );

    assert.ok(
      result.preview[0].issues.length >= 3,
      'each bad cell should be reported so one upload round-trip fixes them all',
    );
  });

  it('detects duplicates inside the file and keeps the first occurrence', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Duplicate' },
      ]),
    );

    assert.equal(result.summary.duplicate_rows_in_file, 1);
    assert.equal(result.summary.rows_to_create, 1);
    const duplicate = result.preview.find((row) => row.row_number === 2);
    assert.equal(duplicate?.status, ImportRowStatus.DUPLICATE_IN_FILE);
    assert.match(duplicate?.issues[0].message ?? '', /repeats row 1/);
  });

  it('treats admission numbers case-insensitively when detecting duplicates', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        { 'Admission Number': 'st001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
      ]),
    );

    assert.equal(result.summary.duplicate_rows_in_file, 1);
  });

  it('detects a record that already exists in the database', async () => {
    const local = makeHarness({
      students: [{ id: 'student-1', school_id: SCHOOL_A, admission_number: 'ST001' }],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    assert.equal(result.summary.existing_records, 1);
    assert.equal(result.summary.rows_to_create, 0);
    assert.equal(result.preview[0].status, ImportRowStatus.EXISTS);
    assert.match(result.preview[0].issues[0].message, /already exists/i);
  });

  it('marks an existing record for update in upsert mode', async () => {
    const local = makeHarness({
      students: [{ id: 'student-1', school_id: SCHOOL_A, admission_number: 'ST001' }],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.UPSERT,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    assert.equal(result.summary.rows_to_update, 1);
    assert.equal(result.summary.rows_to_skip, 0);
    assert.equal(result.preview[0].status, ImportRowStatus.WILL_UPDATE);
  });

  it('reports a mixed file bucket by bucket, with no row left unaccounted for', async () => {
    const local = makeHarness({
      students: [{ id: 'student-1', school_id: SCHOOL_A, admission_number: 'ST900' }],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        { 'Admission Number': 'ST002', 'First Name': 'Grace', 'Last Name': 'Hopper' },
        { 'Admission Number': 'ST002', 'First Name': 'Grace', 'Last Name': 'Hopper' },
        { 'Admission Number': 'ST900', 'First Name': 'Existing', 'Last Name': 'Student' },
        { 'Admission Number': 'ST004', 'First Name': 'NoSurname' },
      ]),
    );

    const { summary } = result;
    assert.equal(summary.total_rows, 5);
    assert.equal(summary.rows_to_create, 2);
    assert.equal(summary.invalid_rows, 1);
    assert.equal(summary.duplicate_rows_in_file, 1);
    assert.equal(summary.rows_to_skip, 3);
    // Nothing silently disappears: every row lands in exactly one bucket.
    assert.equal(summary.rows_to_create + summary.rows_to_update + summary.rows_to_skip, 5);
  });

  it('puts problem rows first in the preview', async () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, index) => ({
        'Admission Number': `OK${index}`,
        'First Name': 'Ada',
        'Last Name': 'Lovelace',
      })),
      { 'Admission Number': 'BAD1', 'First Name': 'Broken' },
    ];

    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile(rows),
    );

    assert.equal(result.preview[0].status, ImportRowStatus.INVALID);
    assert.equal(result.preview[0].row_number, 6);
  });
});

describe('ImportService.validate — reference resolution and tenancy', () => {
  it('resolves a home stop from route code plus stop name', async () => {
    const local = makeHarness({ routes: [ROUTE_NORTH], stops: [STOP_MAPLE] });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        {
          'Admission Number': 'ST001',
          'First Name': 'Ada',
          'Last Name': 'Lovelace',
          'Route Code': 'NORTH-AM',
          'Home Stop': 'Maple St',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 1);
    assert.equal(result.summary.invalid_rows, 0);
  });

  it('refuses a route that belongs to a different school', async () => {
    // The route exists — but for SCHOOL_B. The tenant-pinned lookup must not
    // find it, and the row must fail rather than silently import unlinked.
    const local = makeHarness({
      routes: [{ ...ROUTE_NORTH, school_id: SCHOOL_B }],
      stops: [STOP_MAPLE],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        {
          'Admission Number': 'ST001',
          'First Name': 'Ada',
          'Last Name': 'Lovelace',
          'Route Code': 'NORTH-AM',
          'Home Stop': 'Maple St',
        },
      ]),
    );

    assert.equal(result.summary.invalid_rows, 1);
    assert.match(result.preview[0].issues[0].message, /Route "NORTH-AM" was not found/);
  });

  it('does not match an existing student from another school', async () => {
    const local = makeHarness({
      students: [{ id: 'other', school_id: SCHOOL_B, admission_number: 'ST001' }],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    // Another school's ST001 is irrelevant here — this is a fresh create.
    assert.equal(result.summary.existing_records, 0);
    assert.equal(result.summary.rows_to_create, 1);
  });

  it('rejects a home stop given without a route code', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        {
          'Admission Number': 'ST001',
          'First Name': 'Ada',
          'Last Name': 'Lovelace',
          'Home Stop': 'Maple St',
        },
      ]),
    );

    assert.equal(result.summary.invalid_rows, 1);
    assert.ok(result.preview[0].issues.some((issue) => issue.column === 'Route Code'));
  });

  it('refuses to link a parent account that does not exist', async () => {
    const result = await harness.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        {
          'Admission Number': 'ST001',
          'First Name': 'Ada',
          'Last Name': 'Lovelace',
          'Parent Email': 'ghost@example.com',
          'Parent Relationship': 'Mother',
        },
      ]),
    );

    assert.equal(result.summary.invalid_rows, 1);
    assert.match(result.preview[0].issues[0].message, /No parent account exists/);
  });
});

describe('ImportService.commit', () => {
  it('writes only the valid rows and reports the rest as skipped', async () => {
    const local = makeHarness();

    const result = await local.service.commit(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        { 'Admission Number': 'ST002', 'First Name': 'Broken' },
      ]),
    );

    assert.equal(result.status, ImportJobStatus.COMPLETED);
    assert.equal(result.created_count, 1);
    assert.equal(result.skipped_count, 1);
    assert.equal(local.students.created.length, 1);
    assert.equal(local.students.created[0].admission_number, 'ST001');
  });

  it('stamps school_id from the token on every written row', async () => {
    const local = makeHarness();

    await local.service.commit(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    assert.equal(local.students.created[0].school_id, SCHOOL_A);
  });

  it('ignores a school_id column an attacker adds to the file', async () => {
    const file = csvFile(
      [...STUDENT_HEADERS, 'School Id'],
      [['ST001', 'Ada', 'Lovelace', '', '', '', '', '', '', '', '', '', '', '', SCHOOL_B]],
    );
    const local = makeHarness();

    const result = await local.service.commit(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      file,
    );

    assert.deepEqual(result.unknown_columns, ['School Id']);
    assert.equal(local.students.created[0].school_id, SCHOOL_A);
  });

  it('updates matched records in upsert mode, scoped to the tenant', async () => {
    const local = makeHarness({
      students: [{ id: 'student-1', school_id: SCHOOL_A, admission_number: 'ST001' }],
    });

    const result = await local.service.commit(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.UPSERT,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Updated' }]),
    );

    assert.equal(result.updated_count, 1);
    assert.equal(result.created_count, 0);
    assert.deepEqual(local.students.updated[0].where, {
      id: 'student-1',
      school_id: SCHOOL_A,
    });
  });

  it('reserves plan capacity for the created rows only', async () => {
    const local = makeHarness({
      students: [{ id: 'student-1', school_id: SCHOOL_A, admission_number: 'ST001' }],
    });

    await local.service.commit(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.UPSERT,
      studentFile([
        { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Updated' },
        { 'Admission Number': 'ST002', 'First Name': 'Grace', 'Last Name': 'Hopper' },
      ]),
    );

    // One update + one create → only one seat is claimed from the plan.
    assert.deepEqual(local.bulkLimitCalls, [{ schoolId: SCHOOL_A, additional: 1 }]);
  });

  it('refuses a file where no row can be imported', async () => {
    const local = makeHarness();

    await assert.rejects(
      () =>
        local.service.commit(
          ACTOR,
          ImportModule.STUDENTS,
          ImportMode.CREATE,
          studentFile([{ 'Admission Number': 'ST001', 'First Name': 'OnlyFirstName' }]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as { details?: { has_error_file?: boolean } };
        assert.equal(body.details?.has_error_file, true);
        return true;
      },
    );

    assert.equal(local.students.created.length, 0);
  });

  it('rolls the whole batch back when the write fails', async () => {
    const local = makeHarness();
    local.students.failNextBulkCreate = new UniqueConstraintError({
      errors: [],
      fields: { admission_number: 'ST001' },
    });

    await assert.rejects(
      () =>
        local.service.commit(
          ACTOR,
          ImportModule.STUDENTS,
          ImportMode.CREATE,
          studentFile([
            { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
            { 'Admission Number': 'ST002', 'First Name': 'Grace', 'Last Name': 'Hopper' },
          ]),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match((error.getResponse() as { message: string }).message, /already exists/i);
        return true;
      },
    );

    // The failed run is still recorded, with zero written.
    const job = local.importJobs.rows.at(-1);
    assert.equal(job?.status, ImportJobStatus.FAILED);
    assert.equal(job?.created_count, 0);
  });

  it('surfaces a Sequelize validation failure as a rolled-back run', async () => {
    const local = makeHarness();
    local.students.failNextBulkCreate = new SequelizeValidationError('invalid', [
      { message: 'first_name cannot be null' } as never,
    ]);

    await assert.rejects(() =>
      local.service.commit(
        ACTOR,
        ImportModule.STUDENTS,
        ImportMode.CREATE,
        studentFile([
          { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        ]),
      ),
    );

    const job = local.importJobs.rows.at(-1);
    assert.equal(job?.status, ImportJobStatus.FAILED);
    assert.match(String(job?.failure_reason), /No rows were imported/);
  });

  it('propagates a plan-limit rejection without writing anything', async () => {
    const local = makeHarness({
      planLimitError: new ConflictException({ message: 'Student limit reached for your plan.' }),
    });

    await assert.rejects(
      () =>
        local.service.commit(
          ACTOR,
          ImportModule.STUDENTS,
          ImportMode.CREATE,
          studentFile([
            { 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
          ]),
        ),
      ConflictException,
    );

    assert.equal(local.students.created.length, 0);
  });
});

describe('ImportService — history and audit', () => {
  it('records a validation as a dry run that wrote nothing', async () => {
    const local = makeHarness();

    await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    const job = local.importJobs.rows[0];
    assert.equal(job.status, ImportJobStatus.VALIDATED);
    assert.equal(job.dry_run, true);
    assert.equal(job.created_count, 0);
    assert.equal(job.school_id, SCHOOL_A);
    assert.equal(job.imported_by, ADMIN_A);
  });

  it('stores the failing rows so the error workbook can be rebuilt later', async () => {
    const local = makeHarness();

    await local.service.validate(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'OnlyFirst' }]),
    );

    const errors = local.importJobs.rows[0].errors as Array<{
      row_number: number;
      values: Record<string, string>;
    }>;
    assert.equal(errors.length, 1);
    assert.equal(errors[0].row_number, 1);
    // The original cell values are preserved so the error file can echo them.
    assert.equal(errors[0].values['Admission Number'], 'ST001');
  });

  it('audits both validate and commit without recording any cell value', async () => {
    const local = makeHarness();
    const file = studentFile([
      {
        'Admission Number': 'ST001',
        'First Name': 'Ada',
        'Last Name': 'Lovelace',
        'Medical Notes': 'Peanut allergy',
      },
    ]);

    await local.service.validate(ACTOR, ImportModule.STUDENTS, ImportMode.CREATE, file);
    await local.service.commit(ACTOR, ImportModule.STUDENTS, ImportMode.CREATE, file);

    assert.deepEqual(
      local.auditEntries.map((entry) => entry.action),
      [AUDIT_ACTIONS.IMPORT_VALIDATE, AUDIT_ACTIONS.IMPORT_COMMIT],
    );
    for (const entry of local.auditEntries) {
      assert.equal(entry.school_id, SCHOOL_A);
      assert.equal(entry.actor_user_id, ADMIN_A);
      const serialized = JSON.stringify(entry);
      assert.ok(
        !serialized.includes('Peanut allergy'),
        'audit metadata must never carry spreadsheet cell values',
      );
      assert.ok(!serialized.includes('Lovelace'));
    }
  });

  it('redacts a password cell before the run is recorded', async () => {
    const local = makeHarness();
    // The email is invalid, so the row fails and its raw cells are retained
    // for the error workbook — exactly the path a password must not survive.
    const file = csvFile(
      ['First Name', 'Last Name', 'Email', 'Password', 'Phone', 'Active'],
      [['Sara', 'Khan', 'not-an-email', 'SuperSecret123', '', '']],
      'parents.csv',
    );

    await local.service.validate(ACTOR, ImportModule.PARENTS, ImportMode.CREATE, file);

    const stored = JSON.stringify(local.importJobs.rows[0].errors);
    assert.ok(
      !stored.includes('SuperSecret123'),
      'a plaintext password must never reach import_jobs.errors',
    );
    const errors = local.importJobs.rows[0].errors as Array<{ values: Record<string, string> }>;
    assert.equal(errors[0].values.Password, '[redacted]');
    // The rest of the row is still preserved so the file stays fixable.
    assert.equal(errors[0].values['First Name'], 'Sara');
  });

  it('leaves a blank password cell blank rather than inventing a redaction', async () => {
    const local = makeHarness();
    const file = csvFile(
      ['First Name', 'Last Name', 'Email', 'Password', 'Phone', 'Active'],
      [['Sara', 'Khan', 'not-an-email', '', '', '']],
      'parents.csv',
    );

    await local.service.validate(ACTOR, ImportModule.PARENTS, ImportMode.CREATE, file);

    const errors = local.importJobs.rows[0].errors as Array<{ values: Record<string, string> }>;
    assert.equal(errors[0].values.Password, '');
  });

  it('still returns a result when the history write fails', async () => {
    const local = makeHarness();
    local.importJobs.create = async () => {
      throw new Error('history table unavailable');
    };

    const result = await local.service.commit(
      ACTOR,
      ImportModule.STUDENTS,
      ImportMode.CREATE,
      studentFile([{ 'Admission Number': 'ST001', 'First Name': 'Ada', 'Last Name': 'Lovelace' }]),
    );

    // Losing the audit row must not undo an import that actually succeeded.
    assert.equal(result.created_count, 1);
    assert.equal(result.job_id, '');
  });
});

describe('ImportService route assignments — overlapping rosters', () => {
  const ROUTE_AM: StubRow = { id: 'route-am', school_id: SCHOOL_A, code: 'AM' };
  const ROUTE_PM: StubRow = { id: 'route-pm', school_id: SCHOOL_A, code: 'PM' };
  const BUS_ONE: StubRow = {
    id: 'bus-1',
    school_id: SCHOOL_A,
    registration_number: 'KA-01-AB-1234',
  };
  const BUS_TWO: StubRow = {
    id: 'bus-2',
    school_id: SCHOOL_A,
    registration_number: 'KA-02-CD-5678',
  };
  const DRIVER_USER: StubRow = {
    id: 'driver-1',
    school_id: SCHOOL_A,
    email: 'driver@example.com',
    role: UserRole.DRIVER,
  };
  const CONDUCTOR_USER: StubRow = {
    id: 'conductor-1',
    school_id: SCHOOL_A,
    email: 'conductor@example.com',
    role: UserRole.CONDUCTOR,
  };

  const ASSIGNMENT_HEADERS = [
    'Route Code',
    'Crew Email',
    'Role',
    'Bus Registration Number',
    'Effective From',
    'Effective To',
    'Active',
  ];

  const crewFile = (
    rows: Array<Record<string, string>>,
    name = 'route_assignments.csv',
  ): UploadedImportFile =>
    csvFile(
      ASSIGNMENT_HEADERS,
      rows.map((row) => ASSIGNMENT_HEADERS.map((header) => row[header] ?? '')),
      name,
    );

  const rosterHarness = (
    options: {
      users?: StubRow[];
      buses?: StubRow[];
      routes?: StubRow[];
      assignments?: StubRow[];
    } = {},
  ) =>
    makeHarness({
      users: options.users ?? [DRIVER_USER, CONDUCTOR_USER],
      buses: options.buses ?? [BUS_ONE, BUS_TWO],
      routes: options.routes ?? [ROUTE_AM, ROUTE_PM],
      assignments: options.assignments ?? [],
    });

  it('flags a row that double-books a driver on two routes inside one file', async () => {
    const local = rosterHarness();

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
        {
          'Route Code': 'PM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-02-CD-5678',
          'Effective From': '2026-06-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 1);
    assert.equal(result.summary.invalid_rows, 1);
    const invalid = result.preview.find((row) => row.row_number === 2);
    assert.equal(invalid?.status, ImportRowStatus.INVALID);
    assert.match(
      invalid?.issues[0]?.message ?? '',
      /driver or conductor is already assigned to another route/,
    );
  });

  it('writes only the non-conflicting row when a file double-books a crew member', async () => {
    const local = rosterHarness();

    const result = await local.service.commit(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
        {
          'Route Code': 'PM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-02-CD-5678',
          'Effective From': '2026-06-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.status, ImportJobStatus.COMPLETED);
    assert.equal(result.created_count, 1);
    assert.equal(result.skipped_count, 1);
    assert.equal(local.assignments.created.length, 1);
    assert.equal(local.assignments.created[0].route_id, 'route-am');
  });

  it('flags a file row overlapping an existing assignment of the same crew member', async () => {
    const local = rosterHarness({
      assignments: [
        {
          id: 'existing-pm',
          school_id: SCHOOL_A,
          route_id: 'route-pm',
          bus_id: 'bus-2',
          user_id: 'driver-1',
          role: RouteAssignmentRole.DRIVER,
          effective_from: '2026-01-01',
          effective_to: null,
          is_active: true,
        },
      ],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-03-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 0);
    assert.equal(result.summary.invalid_rows, 1);
    assert.match(
      result.preview[0].issues[0]?.message ?? '',
      /driver or conductor is already assigned to another route/,
    );
  });

  it('still allows the driver + conductor pair on the same route in one file', async () => {
    const local = rosterHarness();

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
        {
          'Route Code': 'AM',
          'Crew Email': 'conductor@example.com',
          Role: 'CONDUCTOR',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 2);
    assert.equal(result.summary.invalid_rows, 0);
  });

  it('allows the same crew member on two routes when the periods do not overlap', async () => {
    const local = rosterHarness();

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-01-01',
          'Effective To': '2026-06-30',
          Active: 'TRUE',
        },
        {
          'Route Code': 'PM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-02-CD-5678',
          'Effective From': '2026-07-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 2);
    assert.equal(result.summary.invalid_rows, 0);
  });

  it('allows overlapping periods when the second roster row is inactive', async () => {
    const local = rosterHarness();

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
        {
          'Route Code': 'PM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-02-CD-5678',
          'Effective From': '2026-06-01',
          'Effective To': '',
          Active: 'FALSE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 2);
    assert.equal(result.summary.invalid_rows, 0);
  });

  it('flags one bus double-booked across two routes inside one file', async () => {
    const local = rosterHarness({
      users: [
        DRIVER_USER,
        { id: 'driver-2', school_id: SCHOOL_A, email: 'other@example.com', role: UserRole.DRIVER },
      ],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
        {
          'Route Code': 'PM',
          'Crew Email': 'other@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-06-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 1);
    assert.equal(result.summary.invalid_rows, 1);
    const invalid = result.preview.find((row) => row.status === ImportRowStatus.INVALID);
    assert.match(
      invalid?.issues[0]?.message ?? '',
      /^This bus is already assigned to another route/,
    );
  });

  it('flags a second driver on the same route during an overlap', async () => {
    const local = rosterHarness({
      users: [
        DRIVER_USER,
        { id: 'driver-2', school_id: SCHOOL_A, email: 'other@example.com', role: UserRole.DRIVER },
      ],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-04-01',
          'Effective To': '',
          Active: 'TRUE',
        },
        {
          'Route Code': 'AM',
          'Crew Email': 'other@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-02-CD-5678',
          'Effective From': '2026-06-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_create, 1);
    assert.equal(result.summary.invalid_rows, 1);
    const invalid = result.preview.find((row) => row.status === ImportRowStatus.INVALID);
    assert.match(
      invalid?.issues[0]?.message ?? '',
      /route already has an active assignment for this role/,
    );
  });

  it('rejects an upsert that would move a bus onto a route that already uses it', async () => {
    const local = rosterHarness({
      users: [
        DRIVER_USER,
        { id: 'driver-2', school_id: SCHOOL_A, email: 'other@example.com', role: UserRole.DRIVER },
      ],
      assignments: [
        {
          id: 'existing-am',
          school_id: SCHOOL_A,
          route_id: 'route-am',
          bus_id: 'bus-1',
          user_id: 'driver-1',
          role: RouteAssignmentRole.DRIVER,
          effective_from: '2026-01-01',
          effective_to: null,
          is_active: true,
        },
        {
          id: 'existing-pm',
          school_id: SCHOOL_A,
          route_id: 'route-pm',
          bus_id: 'bus-2',
          user_id: 'driver-2',
          role: RouteAssignmentRole.DRIVER,
          effective_from: '2026-07-01',
          effective_to: null,
          is_active: true,
        },
      ],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.UPSERT,
      crewFile([
        {
          'Route Code': 'PM',
          'Crew Email': 'other@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-07-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.rows_to_update, 0);
    assert.equal(result.summary.invalid_rows, 1);
    assert.match(
      result.preview[0].issues[0]?.message ?? '',
      /^This bus is already assigned to another route/,
    );
  });

  it('keeps conflict detection tenant-scoped', async () => {
    const local = rosterHarness({
      assignments: [
        {
          id: 'other-school',
          school_id: SCHOOL_B,
          route_id: 'route-am',
          bus_id: 'bus-1',
          user_id: 'driver-1',
          role: RouteAssignmentRole.DRIVER,
          effective_from: '2026-01-01',
          effective_to: null,
          is_active: true,
        },
      ],
    });

    const result = await local.service.validate(
      ACTOR,
      ImportModule.ROUTE_ASSIGNMENTS,
      ImportMode.CREATE,
      crewFile([
        {
          'Route Code': 'AM',
          'Crew Email': 'driver@example.com',
          Role: 'DRIVER',
          'Bus Registration Number': 'KA-01-AB-1234',
          'Effective From': '2026-03-01',
          'Effective To': '',
          Active: 'TRUE',
        },
      ]),
    );

    assert.equal(result.summary.existing_records, 0);
    assert.equal(result.summary.rows_to_create, 1);
    assert.equal(result.summary.invalid_rows, 0);
  });
});
