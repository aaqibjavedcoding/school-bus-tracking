import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { Writable } from 'node:stream';
import {
  DataFileFormat,
  EXPORT_DATASET_VALUES,
  ExportDataset,
  UserRole,
  type ExportQuery,
} from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, type AuditService } from '../../audit';
import { getExportDefinition } from './definitions';
import { ExportService } from './export.service';
import {
  activeClause,
  dateRangeClause,
  escapeLikePattern,
  formatBoolean,
  formatDate,
  formatDateTime,
  searchClause,
  text,
} from './export.types';

/**
 * Export tests.
 *
 * The datasets are driven through the real definitions with in-memory model
 * doubles, so what is asserted is the actual `where` clause and the actual
 * column list a school would receive.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Row {
  id: string;
  school_id: string;
  [key: string]: unknown;
}

/** Records the queries it is asked to run, and answers them from memory. */
class StubModel {
  public readonly queries: Array<Record<string, unknown>> = [];

  constructor(public rows: Row[] = []) {}

  private match(where: Record<string, unknown> = {}): Row[] {
    return this.rows.filter((row) =>
      Object.entries(where).every(([key, condition]) => {
        if (condition && typeof condition === 'object') {
          const inList = (condition as Record<symbol, unknown>)[Op.in as unknown as symbol];
          if (Array.isArray(inList)) {
            return inList.includes(row[key]);
          }
          return true;
        }
        return row[key] === condition;
      }),
    );
  }

  async count(options: { where?: Record<string, unknown> } = {}): Promise<number> {
    this.queries.push(options);
    return this.match(options.where).length;
  }

  async findAll(
    options: { where?: Record<string, unknown>; offset?: number; limit?: number } = {},
  ): Promise<Row[]> {
    this.queries.push(options);
    const matched = this.match(options.where);
    const offset = options.offset ?? 0;
    return matched.slice(offset, options.limit ? offset + options.limit : undefined);
  }
}

function makeService(overrides: Partial<Record<string, StubModel>> = {}): {
  service: ExportService;
  models: Record<string, StubModel>;
  audit: Array<Record<string, unknown>>;
} {
  const names = [
    'students',
    'guardians',
    'users',
    'buses',
    'routes',
    'stops',
    'assignments',
    'trips',
    'attendance',
    'notifications',
    'busDocuments',
    'driverDocuments',
  ];
  const models: Record<string, StubModel> = {};
  for (const name of names) {
    models[name] = overrides[name] ?? new StubModel();
  }

  const audit: Array<Record<string, unknown>> = [];
  const auditService = {
    async log(entry: Record<string, unknown>) {
      audit.push(entry);
    },
  } as unknown as AuditService;

  const service = new ExportService(
    models.students as never,
    models.guardians as never,
    models.users as never,
    models.buses as never,
    models.routes as never,
    models.stops as never,
    models.assignments as never,
    models.trips as never,
    models.attendance as never,
    models.notifications as never,
    models.busDocuments as never,
    models.driverDocuments as never,
    auditService,
  );

  return { service, models, audit };
}

/** Drains a prepared export into a buffer through a real writable stream. */
async function render(plan: { stream(sink: Writable): Promise<number> }): Promise<{
  written: number;
  text: string;
}> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  const written = await plan.stream(sink);
  if (!sink.writableEnded) {
    await new Promise<void>((resolve) => sink.end(resolve));
  }
  return { written, text: Buffer.concat(chunks).toString('utf8') };
}

function student(overrides: Partial<Row> = {}): Row {
  return {
    id: `student-${Math.random().toString(16).slice(2)}`,
    school_id: SCHOOL_A,
    admission_number: 'ST001',
    first_name: 'Ada',
    last_name: 'Lovelace',
    grade_level: 'Grade 5',
    gender: 'FEMALE',
    date_of_birth: new Date('2016-03-15T00:00:00.000Z'),
    home_stop_id: null,
    emergency_contact_name: 'Anne Byron',
    emergency_contact_phone: '+91 98765 43210',
    medical_notes: 'Peanut allergy',
    is_active: true,
    created_at: new Date('2026-01-05T09:00:00.000Z'),
    ...overrides,
  };
}

describe('export definitions — catalogue integrity', () => {
  it('has a definition for every advertised dataset', () => {
    for (const dataset of EXPORT_DATASET_VALUES) {
      const definition = getExportDefinition(dataset);
      assert.equal(definition.dataset, dataset);
      assert.ok(definition.columns.length > 0, `${dataset} must export at least one column`);
      assert.ok(definition.fileBase.length > 0);
    }
  });

  it('never exposes a credential, token or internal marker in any column', () => {
    // A single forbidden header anywhere in the catalogue is a data leak, so
    // this sweeps all of them rather than spot-checking one dataset.
    const forbidden = [
      /password/i,
      /hash/i,
      /token/i,
      /secret/i,
      /salt/i,
      /deleted[ _]?at/i,
      /\bsalt\b/i,
      /refresh/i,
      /otp/i,
      /verification/i,
    ];

    for (const dataset of EXPORT_DATASET_VALUES) {
      for (const column of getExportDefinition(dataset).columns) {
        for (const pattern of forbidden) {
          assert.ok(
            !pattern.test(column.header),
            `${dataset} exports a forbidden column: "${column.header}"`,
          );
        }
      }
    }
  });

  it('excludes medical notes from the student export', () => {
    const headers = getExportDefinition(ExportDataset.STUDENTS).columns.map(
      (column) => column.header,
    );
    assert.ok(!headers.some((header) => /medical/i.test(header)));
  });

  it('rejects an unknown dataset instead of guessing', () => {
    assert.throws(() => getExportDefinition('payroll' as ExportDataset));
  });
});

describe('ExportService.prepare — tenancy and filters', () => {
  it('scopes every query to the authenticated school', async () => {
    const students = new StubModel([
      student({ id: 's1', school_id: SCHOOL_A }),
      student({ id: 's2', school_id: SCHOOL_B, admission_number: 'OTHER' }),
    ]);
    const { service } = makeService({ students });

    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {});

    assert.equal(plan.total, 1);
    assert.equal((students.queries[0].where as Record<string, unknown>).school_id, SCHOOL_A);
  });

  it('cannot be talked into exporting another school by any query value', async () => {
    const students = new StubModel([student({ id: 's2', school_id: SCHOOL_B })]);
    const { service } = makeService({ students });

    // Even if a caller smuggles a school id in, the where clause is built from
    // the token's school and the foreign rows stay invisible.
    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      search: SCHOOL_B,
    } as ExportQuery);

    assert.equal(plan.total, 0);
    const { written } = await render(plan);
    assert.equal(written, 0);
  });

  it('applies the active-status filter the list screen sends', async () => {
    const students = new StubModel([
      student({ id: 's1', is_active: true }),
      student({ id: 's2', is_active: false, admission_number: 'ST002' }),
    ]);
    const { service } = makeService({ students });

    const active = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      status: 'active',
    });
    assert.equal(active.total, 1);

    const inactive = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      status: 'inactive',
    });
    assert.equal(inactive.total, 1);
  });

  it('ignores a filter the dataset does not understand rather than failing', async () => {
    const students = new StubModel([student()]);
    const { service } = makeService({ students });

    // The web app forwards its whole filter state; a dataset that has no
    // concept of `trip_id` must simply not narrow on it.
    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      trip_id: '11111111-1111-4111-8111-111111111111',
    } as ExportQuery);

    assert.equal(plan.total, 1);
  });
});

describe('ExportService.prepare — output', () => {
  it('streams a CSV whose header row matches the definition', async () => {
    const students = new StubModel([student()]);
    const { service } = makeService({ students });

    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      format: DataFileFormat.CSV,
    });
    const { written, text: body } = await render(plan);

    assert.equal(written, 1);
    const [header, first] = body
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    assert.equal(
      header,
      getExportDefinition(ExportDataset.STUDENTS)
        .columns.map((column) => column.header)
        .join(','),
    );
    assert.match(first, /^ST001,Ada,Lovelace,Grade 5,FEMALE,2016-03-15/);
  });

  it('does not leak medical notes into the streamed rows', async () => {
    const students = new StubModel([student()]);
    const { service } = makeService({ students });

    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      format: DataFileFormat.CSV,
    });
    const { text: body } = await render(plan);

    assert.ok(!body.includes('Peanut allergy'));
  });

  it('produces a header-only file when nothing matches', async () => {
    const { service } = makeService({ students: new StubModel([]) });

    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      format: DataFileFormat.CSV,
    });
    const { written, text: body } = await render(plan);

    assert.equal(plan.total, 0);
    assert.equal(written, 0);
    assert.equal(
      body
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n').length,
      1,
    );
  });

  it('pages a large dataset instead of loading it all at once', async () => {
    const rows = Array.from({ length: 1200 }, (_, index) =>
      student({ id: `s${index}`, admission_number: `ST${index}` }),
    );
    const students = new StubModel(rows);
    const { service } = makeService({ students });

    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      format: DataFileFormat.CSV,
    });
    const { written } = await render(plan);

    assert.equal(plan.total, 1200);
    assert.equal(written, 1200);

    const pageSizes = students.queries
      .filter((query) => query.limit !== undefined)
      .map((query) => query.limit);
    assert.ok(pageSizes.length >= 3, 'a 1200-row export must be fetched in several pages');
    assert.ok(
      pageSizes.every((size) => size === 500),
      'each page must stay at the streaming page size',
    );
  });

  it('names the file after the dataset and the format', async () => {
    const { service } = makeService({ students: new StubModel([student()]) });

    const xlsx = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {});
    assert.match(xlsx.fileName, /^students_\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.equal(
      xlsx.contentType,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const csv = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      format: DataFileFormat.CSV,
    });
    assert.match(csv.fileName, /\.csv$/);
    assert.match(csv.contentType, /^text\/csv/);
  });
});

describe('ExportService.prepare — audit', () => {
  it('logs who exported what, with the record count', async () => {
    const { service, audit } = makeService({ students: new StubModel([student(), student()]) });

    await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, {
      status: 'active',
      format: DataFileFormat.CSV,
    });

    assert.equal(audit.length, 1);
    const entry = audit[0];
    assert.equal(entry.action, AUDIT_ACTIONS.EXPORT_DOWNLOAD);
    assert.equal(entry.school_id, SCHOOL_A);
    assert.equal(entry.actor_user_id, ADMIN_A);
    const metadata = entry.metadata as Record<string, unknown>;
    assert.equal(metadata.dataset, ExportDataset.STUDENTS);
    assert.equal(metadata.format, DataFileFormat.CSV);
    assert.equal(metadata.record_count, 2);
    assert.deepEqual(metadata.filters_applied, { status: 'active' });
  });

  it('records that a search happened but never the term itself', async () => {
    const { service, audit } = makeService({ students: new StubModel([]) });

    await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.STUDENTS, { search: 'Ada Lovelace' });

    const metadata = audit[0].metadata as { filters_applied: Record<string, unknown> };
    assert.equal(metadata.filters_applied.search, true);
    assert.ok(!JSON.stringify(audit[0]).includes('Lovelace'));
  });
});

describe('export query helpers', () => {
  it('escapes LIKE wildcards so a search term is matched literally', () => {
    assert.equal(escapeLikePattern('100%'), '100\\%');
    assert.equal(escapeLikePattern('a_b'), 'a\\_b');
    assert.equal(escapeLikePattern('back\\slash'), 'back\\\\slash');
  });

  it('builds no clause at all for an absent search', () => {
    assert.deepEqual(searchClause(undefined, ['first_name']), []);
  });

  it('builds an OR of iLIKE clauses across the searchable columns', () => {
    const [clause] = searchClause('ada', ['first_name', 'last_name']) as Array<
      Record<symbol, Array<Record<string, Record<symbol, string>>>>
    >;
    const branches = clause[Op.or as unknown as symbol];
    assert.equal(branches.length, 2);
    assert.equal(branches[0].first_name[Op.iLike as unknown as symbol], '%ada%');
  });

  it('maps only the two statuses a list screen can send', () => {
    assert.deepEqual(activeClause('active'), { is_active: true });
    assert.deepEqual(activeClause('inactive'), { is_active: false });
    assert.deepEqual(activeClause('archived'), {});
    assert.deepEqual(activeClause(undefined), {});
  });

  it('treats the end of a date range as inclusive', () => {
    const clause = dateRangeClause('scheduled_start_at', '2026-03-01', '2026-03-31') as Record<
      string,
      Record<symbol, Date>
    >;
    const range = clause.scheduled_start_at;
    assert.equal(range[Op.gte as unknown as symbol].toISOString(), '2026-03-01T00:00:00.000Z');
    // Exclusive upper bound at the start of 1 April keeps all of 31 March in.
    assert.equal(range[Op.lt as unknown as symbol].toISOString(), '2026-04-01T00:00:00.000Z');
  });

  it('builds no date clause when neither bound is given', () => {
    assert.deepEqual(dateRangeClause('created_at', undefined, undefined), {});
  });

  it('formats cells so a spreadsheet never shows the word null', () => {
    assert.equal(text(null), '');
    assert.equal(text(undefined), '');
    assert.equal(text(0), '0');
    assert.equal(formatBoolean(true), 'Yes');
    assert.equal(formatBoolean(false), 'No');
    assert.equal(formatBoolean(null), 'No');
    assert.equal(formatDate(new Date('2026-03-15T12:00:00.000Z')), '2026-03-15');
    assert.equal(formatDate('2026-03-15'), '2026-03-15');
    assert.equal(formatDate(null), '');
    assert.equal(formatDateTime(new Date('2026-03-15T08:30:00.000Z')), '2026-03-15 08:30');
    assert.equal(formatDateTime('not a date'), '');
  });
});

describe('user-facing exports', () => {
  it('exports drivers without touching the password column', async () => {
    const users = new StubModel([
      {
        id: 'u1',
        school_id: SCHOOL_A,
        role: UserRole.DRIVER,
        first_name: 'Sam',
        last_name: 'Driver',
        email: 'sam@example.com',
        phone: '+91 90000 00000',
        password_hash: '$2b$10$averysecrethashvalue',
        is_active: true,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const { service } = makeService({ users });

    const plan = await service.prepare(SCHOOL_A, ADMIN_A, ExportDataset.DRIVERS, {
      format: DataFileFormat.CSV,
    });
    const { text: body } = await render(plan);

    assert.match(body, /sam@example\.com/);
    assert.ok(!body.includes('$2b$10$'), 'a password hash must never reach the file');
  });
});
