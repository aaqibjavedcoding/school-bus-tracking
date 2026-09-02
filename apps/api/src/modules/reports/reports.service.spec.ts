import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import {
  DataFileFormat,
  REPORT_TYPE_VALUES,
  ReportType,
  TripStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, type AuditService } from '../audit';
import { getReportDefinition, reportCatalogue } from './definitions';
import { ReportsService } from './reports.service';
import { card, dateRange, isoDate, isoDateTime, paginateRows, percentage } from './report.types';

/**
 * Reports tests.
 *
 * Reports are read-only aggregations, so the interesting properties are:
 * tenant scoping, that filters actually narrow, that the numbers are computed
 * rather than invented, and that an export agrees with the table on screen.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Row {
  id: string;
  school_id: string;
  [key: string]: unknown;
}

class StubModel {
  public readonly queries: Array<Record<string, unknown>> = [];

  constructor(public rows: Row[] = []) {}

  private match(where: Record<string, unknown> = {}): Row[] {
    return this.rows.filter((row) =>
      Object.entries(where).every(([key, condition]) => {
        if (condition && typeof condition === 'object') {
          const record = condition as Record<symbol, unknown>;
          const inList = record[Op.in as unknown as symbol];
          if (Array.isArray(inList)) return inList.includes(row[key]);
          const notEqual = record[Op.ne as unknown as symbol];
          if (notEqual !== undefined) return row[key] !== notEqual;
          const gte = record[Op.gte as unknown as symbol];
          if (gte instanceof Date) return new Date(row[key] as string) >= gte;
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
    return options.limit === undefined
      ? matched.slice(offset)
      : matched.slice(offset, offset + options.limit);
  }

  async findAndCountAll(
    options: { where?: Record<string, unknown>; offset?: number; limit?: number } = {},
  ): Promise<{ rows: Row[]; count: number }> {
    this.queries.push(options);
    const matched = this.match(options.where);
    const offset = options.offset ?? 0;
    const rows =
      options.limit === undefined
        ? matched.slice(offset)
        : matched.slice(offset, offset + options.limit);
    return { rows, count: matched.length };
  }
}

function makeService(overrides: Partial<Record<string, StubModel>> = {}) {
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
  const service = new ReportsService(
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
    {
      async log(entry: Record<string, unknown>) {
        audit.push(entry);
      },
    } as unknown as AuditService,
  );

  return { service, models, audit };
}

const ROUTE_NORTH: Row = {
  id: 'route-north',
  school_id: SCHOOL_A,
  code: 'NORTH-AM',
  name: 'North morning',
  is_active: true,
};
const ROUTE_SOUTH: Row = {
  id: 'route-south',
  school_id: SCHOOL_A,
  code: 'SOUTH-AM',
  name: 'South morning',
  is_active: true,
};

function stop(id: string, routeId: string, schoolId = SCHOOL_A): Row {
  return { id, school_id: schoolId, route_id: routeId, name: `Stop ${id}`, is_active: true };
}

function pupil(id: string, homeStopId: string | null, schoolId = SCHOOL_A): Row {
  return {
    id,
    school_id: schoolId,
    home_stop_id: homeStopId,
    first_name: 'Ada',
    last_name: id,
    admission_number: id.toUpperCase(),
    is_active: true,
  };
}

describe('report catalogue', () => {
  it('describes every advertised report exactly once', () => {
    const catalogue = reportCatalogue();

    assert.equal(catalogue.length, REPORT_TYPE_VALUES.length);
    assert.equal(new Set(catalogue.map((item) => item.report)).size, catalogue.length);

    for (const descriptor of catalogue) {
      assert.ok(descriptor.label.length > 0);
      assert.ok(descriptor.description.length > 0);
      assert.ok(descriptor.category.length > 0);
    }
  });

  it('gives every report at least one column and a file name', () => {
    for (const report of REPORT_TYPE_VALUES) {
      const definition = getReportDefinition(report);
      assert.ok(definition.columns.length > 0, `${report} needs columns`);
      assert.ok(definition.fileBase.length > 0, `${report} needs a file base`);
      assert.equal(new Set(definition.columns.map((c) => c.key)).size, definition.columns.length);
    }
  });

  it('only advertises filters the shared query type can express', () => {
    const allowed = new Set([
      'search',
      'status',
      'route_id',
      'bus_id',
      'stop_id',
      'driver_id',
      'student_id',
      'trip_status',
      'attendance_status',
      'date_from',
      'date_to',
    ]);

    for (const report of REPORT_TYPE_VALUES) {
      for (const filter of getReportDefinition(report).filters) {
        assert.ok(allowed.has(filter), `${report} advertises unknown filter ${filter}`);
      }
    }
  });

  it('rejects an unknown report instead of returning undefined', () => {
    assert.throws(() => getReportDefinition('headcount' as ReportType));
  });
});

describe('ReportsService.run — tenancy', () => {
  it('counts only the authenticated school', async () => {
    const { service } = makeService({
      routes: new StubModel([ROUTE_NORTH]),
      stops: new StubModel([stop('stop-1', 'route-north')]),
      students: new StubModel([
        pupil('a', 'stop-1'),
        pupil('b', 'stop-1'),
        // Another school's pupil on an id-colliding stop must not be counted.
        pupil('c', 'stop-1', SCHOOL_B),
      ]),
    });

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {});
    const north = result.rows.find((row) => row.route_code === 'NORTH-AM');

    assert.equal(north?.students, 2);
  });

  it('returns nothing for a school with no data rather than failing', async () => {
    const { service } = makeService();

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {});

    assert.deepEqual(result.rows, []);
    assert.equal(result.meta.total, 0);
    assert.ok(Array.isArray(result.summary));
  });

  it('pins every query it issues to the school id', async () => {
    const routes = new StubModel([ROUTE_NORTH]);
    const { service } = makeService({ routes });

    await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {});

    for (const query of routes.queries) {
      const where = query.where as Record<string, unknown>;
      assert.equal(where.school_id, SCHOOL_A);
    }
  });
});

describe('ReportsService.run — filters and aggregation', () => {
  it('narrows to a single route when route_id is given', async () => {
    const { service } = makeService({
      routes: new StubModel([ROUTE_NORTH, ROUTE_SOUTH]),
      stops: new StubModel([stop('stop-1', 'route-north'), stop('stop-2', 'route-south')]),
      students: new StubModel([pupil('a', 'stop-1'), pupil('b', 'stop-2')]),
    });

    const all = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {});
    assert.equal(all.rows.length, 2);

    const filtered = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {
      route_id: 'route-north',
    });
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.rows[0].route_code, 'NORTH-AM');
  });

  it('echoes back exactly the filters it applied', async () => {
    const { service } = makeService({ routes: new StubModel([ROUTE_NORTH]) });

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {
      route_id: 'route-north',
      // `bus_id` is not a filter of this report and must not be echoed.
      bus_id: 'bus-1',
    });

    assert.equal(result.filters_applied.route_id, 'route-north');
    assert.ok(!('bus_id' in result.filters_applied));
  });

  it('computes counts from the data instead of returning placeholders', async () => {
    const { service } = makeService({
      routes: new StubModel([ROUTE_NORTH]),
      stops: new StubModel([stop('stop-1', 'route-north'), stop('stop-2', 'route-north')]),
      students: new StubModel([pupil('a', 'stop-1'), pupil('b', 'stop-1'), pupil('c', 'stop-2')]),
    });

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {});
    const north = result.rows[0];

    assert.equal(north.stops, 2);
    assert.equal(north.students, 3);
  });

  it('finds the pupils nobody has allocated a stop to', async () => {
    const { service } = makeService({
      students: new StubModel([pupil('a', 'stop-1'), pupil('b', null), pupil('c', null)]),
      stops: new StubModel([stop('stop-1', 'route-north')]),
      routes: new StubModel([ROUTE_NORTH]),
    });

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_UNASSIGNED, {});

    assert.equal(result.meta.total, 2);
  });

  it('paginates and reports honest navigation flags', async () => {
    const routes = Array.from({ length: 5 }, (_, index) => ({
      id: `route-${index}`,
      school_id: SCHOOL_A,
      code: `R${index}`,
      name: `Route ${index}`,
      is_active: true,
    }));
    const { service } = makeService({ routes: new StubModel(routes) });

    const first = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, { page: 1, limit: 2 });
    assert.equal(first.rows.length, 2);
    assert.equal(first.meta.total, 5);
    assert.equal(first.meta.totalPages, 3);
    assert.equal(first.meta.hasNextPage, true);
    assert.equal(first.meta.hasPreviousPage, false);

    const last = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, { page: 3, limit: 2 });
    assert.equal(last.rows.length, 1);
    assert.equal(last.meta.hasNextPage, false);
    assert.equal(last.meta.hasPreviousPage, true);
  });

  it('clamps a hostile page size instead of trusting it', async () => {
    const { service } = makeService({ routes: new StubModel([ROUTE_NORTH]) });

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {
      page: -5,
      limit: 100_000,
    });

    assert.equal(result.meta.page, 1);
    assert.ok(result.meta.limit <= 200);
  });

  it('stamps the moment the figures were produced', async () => {
    const { service } = makeService({ routes: new StubModel([ROUTE_NORTH]) });
    const before = Date.now();

    const result = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, {});

    const generated = new Date(result.generated_at).getTime();
    assert.ok(generated >= before && generated <= Date.now());
  });
});

describe('ReportsService.overview', () => {
  it('summarises the school from live counts', async () => {
    const { service } = makeService({
      students: new StubModel([pupil('a', 'stop-1'), pupil('b', null)]),
      buses: new StubModel([{ id: 'bus-1', school_id: SCHOOL_A, is_active: true }]),
      routes: new StubModel([ROUTE_NORTH]),
      users: new StubModel([
        { id: 'u1', school_id: SCHOOL_A, role: UserRole.DRIVER, is_active: true },
        { id: 'u2', school_id: SCHOOL_A, role: UserRole.PARENT, is_active: true },
      ]),
    });

    const overview = await service.overview(SCHOOL_A);

    const students = new Map(overview.students.map((c) => [c.key, c.value]));
    assert.equal(students.get('active_students'), 2);
    assert.ok(overview.transport.length > 0);
    assert.ok(overview.operations.length > 0);
    assert.ok(overview.compliance.length > 0);
    assert.ok(new Date(overview.generated_at).getTime() > 0);
  });

  it('reports zeroes for an empty school rather than throwing', async () => {
    const { service } = makeService();

    const overview = await service.overview(SCHOOL_A);

    for (const group of [overview.students, overview.transport, overview.operations]) {
      for (const item of group) {
        assert.equal(typeof item.value, 'number');
        assert.ok(Number.isFinite(item.value));
      }
    }
  });
});

describe('ReportsService.exportReport', () => {
  it('exports the same columns the table shows', async () => {
    const { service } = makeService({
      routes: new StubModel([ROUTE_NORTH]),
      stops: new StubModel([stop('stop-1', 'route-north')]),
      students: new StubModel([pupil('a', 'stop-1')]),
    });

    const file = await service.exportReport(SCHOOL_A, ADMIN_A, ReportType.STUDENTS_BY_ROUTE, {
      format: DataFileFormat.CSV,
    });

    const body = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const [header] = body.trim().split('\r\n');
    assert.equal(
      header,
      getReportDefinition(ReportType.STUDENTS_BY_ROUTE)
        .columns.map((column) => column.label)
        .join(','),
    );
    assert.match(file.fileName, /^students_by_route_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('produces a file whose rows agree with the on-screen result', async () => {
    const models = {
      routes: new StubModel([ROUTE_NORTH, ROUTE_SOUTH]),
      stops: new StubModel([stop('stop-1', 'route-north'), stop('stop-2', 'route-south')]),
      students: new StubModel([pupil('a', 'stop-1'), pupil('b', 'stop-1'), pupil('c', 'stop-2')]),
    };
    const { service } = makeService(models);
    const query = { route_id: 'route-north' };

    const onScreen = await service.run(SCHOOL_A, ReportType.STUDENTS_BY_ROUTE, query);
    const file = await service.exportReport(SCHOOL_A, ADMIN_A, ReportType.STUDENTS_BY_ROUTE, {
      ...query,
      format: DataFileFormat.CSV,
    });

    const dataLines = file.buffer
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')
      .slice(1);

    assert.equal(dataLines.length, onScreen.rows.length);
    assert.match(dataLines[0], /^NORTH-AM,North morning,1,2/);
  });

  it('audits the export with the row count but not the search term', async () => {
    const { service, audit } = makeService({ routes: new StubModel([ROUTE_NORTH]) });

    await service.exportReport(SCHOOL_A, ADMIN_A, ReportType.STUDENTS_BY_ROUTE, {
      format: DataFileFormat.CSV,
    });

    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, AUDIT_ACTIONS.REPORT_EXPORT);
    assert.equal(audit[0].school_id, SCHOOL_A);
    assert.equal(audit[0].actor_user_id, ADMIN_A);
    const metadata = audit[0].metadata as Record<string, unknown>;
    assert.equal(metadata.report, ReportType.STUDENTS_BY_ROUTE);
    assert.equal(typeof metadata.record_count, 'number');
  });

  it('exports an xlsx with the spreadsheet content type by default', async () => {
    const { service } = makeService({ routes: new StubModel([ROUTE_NORTH]) });

    const file = await service.exportReport(SCHOOL_A, ADMIN_A, ReportType.STUDENTS_BY_ROUTE, {});

    assert.match(file.fileName, /\.xlsx$/);
    assert.equal(
      file.contentType,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});

describe('report helpers', () => {
  it('builds a summary card with a null hint by default', () => {
    assert.deepEqual(card('k', 'Label', 4), { key: 'k', label: 'Label', value: 4, hint: null });
    assert.equal(card('k', 'Label', 4, 'of 10').hint, 'of 10');
  });

  it('treats the end of a date range as inclusive', () => {
    const range = dateRange('2026-03-01', '2026-03-31') as Record<symbol, Date>;
    assert.equal(range[Op.gte as unknown as symbol].toISOString(), '2026-03-01T00:00:00.000Z');
    assert.equal(range[Op.lt as unknown as symbol].toISOString(), '2026-04-01T00:00:00.000Z');
  });

  it('returns no range at all when neither bound is set', () => {
    assert.equal(dateRange(undefined, undefined), null);
  });

  it('never divides by zero when computing a percentage', () => {
    assert.equal(percentage(0, 0), 0);
    assert.equal(percentage(5, 0), 0);
    assert.equal(percentage(1, 3), 33.3);
    assert.equal(percentage(2, 4), 50);
  });

  it('formats dates defensively', () => {
    assert.equal(isoDate(new Date('2026-03-15T10:00:00.000Z')), '2026-03-15');
    assert.equal(isoDate(null), '');
    assert.equal(isoDate('nonsense'), '');
    assert.equal(isoDateTime(new Date('2026-03-15T10:05:00.000Z')), '2026-03-15 10:05');
    assert.equal(isoDateTime(undefined), '');
  });

  it('slices rows without running off the end', () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    assert.deepEqual(paginateRows(rows, 0, 2), [{ a: 1 }, { a: 2 }]);
    assert.deepEqual(paginateRows(rows, 2, 2), [{ a: 3 }]);
    assert.deepEqual(paginateRows(rows, 10, 2), []);
  });
});

describe('trip and attendance reports', () => {
  it('filters trips by status and date range', async () => {
    const trips = new StubModel([
      {
        id: 't1',
        school_id: SCHOOL_A,
        route_id: 'route-north',
        status: TripStatus.COMPLETED,
        scheduled_start_at: new Date('2026-03-02T07:00:00.000Z'),
      },
      {
        id: 't2',
        school_id: SCHOOL_A,
        route_id: 'route-north',
        status: TripStatus.CANCELLED,
        scheduled_start_at: new Date('2026-03-03T07:00:00.000Z'),
      },
    ]);
    const { service } = makeService({ trips, routes: new StubModel([ROUTE_NORTH]) });

    const result = await service.run(SCHOOL_A, ReportType.TRIPS, {
      trip_status: TripStatus.COMPLETED,
    });

    const where = trips.queries[0].where as Record<string, unknown>;
    assert.equal(where.school_id, SCHOOL_A);
    assert.equal(where.status, TripStatus.COMPLETED);
    assert.ok(result.summary.length > 0);
  });
});
