import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DataFileFormat,
  IMPORT_MODULE_LABELS,
  ImportModule,
  ImportRowStatus,
  type ImportRowError,
} from '@school-bus-tracking/shared-types';
import { parseSpreadsheet } from '../excel/excel.util';
import { IMPORT_MODULE_ORDER, getImportDefinition } from './definitions';
import {
  ERROR_MESSAGE_COLUMN,
  IMPORT_STATUS_COLUMN,
  buildErrorWorkbook,
  errorFileName,
  formatIssues,
} from './import-error-file.builder';
import { ImportTemplateService } from './import-template.service';

/**
 * Templates and the error workbook.
 *
 * Both are the admin-facing contract of the import feature: the template is
 * what they fill in, the error file is what they get back when it goes wrong.
 * These tests pin the round trip — a template must upload cleanly, and an error
 * file must be fixable in place and re-uploadable.
 */

const service = new ImportTemplateService();

describe('ImportTemplateService.listModules', () => {
  it('describes every module the registry advertises', () => {
    const { items } = service.listModules();

    assert.equal(items.length, IMPORT_MODULE_ORDER.length);
    assert.deepEqual(
      items.map((item) => item.module),
      IMPORT_MODULE_ORDER,
    );
    for (const item of items) {
      assert.equal(item.label, IMPORT_MODULE_LABELS[item.module]);
      assert.ok(item.description.length > 0, `${item.module} needs a description`);
      assert.ok(item.natural_key.length > 0, `${item.module} needs a duplicate key`);
      assert.ok(item.max_rows > 0);
      assert.ok(item.columns.length > 0);
      assert.ok(
        item.columns.some((column) => column.required),
        `${item.module} must have at least one required column`,
      );
    }
  });

  it('caps account-creating imports well below the general row limit', () => {
    const items = new Map(service.listModules().items.map((item) => [item.module, item]));

    // Password hashing is deliberately slow, so these modules cannot take a
    // 5 000-row file without tying up a worker for minutes.
    assert.ok(items.get(ImportModule.PARENTS)!.max_rows <= 500);
    assert.ok(items.get(ImportModule.DRIVERS)!.max_rows <= 500);
    assert.ok(items.get(ImportModule.CONDUCTORS)!.max_rows <= 500);
    assert.ok(items.get(ImportModule.STUDENTS)!.max_rows > 500);
  });

  it('marks the password column of an account import as sensitive', () => {
    // Account imports legitimately need an initial password, but the raw cell
    // must never be retained — see the redaction test in import.service.spec.
    for (const module of IMPORT_MODULE_ORDER) {
      for (const column of getImportDefinition(module).columns) {
        if (/password/i.test(column.header)) {
          assert.equal(
            column.sensitive,
            true,
            `${module}.${column.header} must be flagged sensitive`,
          );
        }
      }
    }
  });

  it('only asks for a password on the modules that create logins', () => {
    const withPassword = IMPORT_MODULE_ORDER.filter((module) =>
      getImportDefinition(module).columns.some((column) => /password/i.test(column.header)),
    );

    assert.deepEqual(
      withPassword.slice().sort(),
      [ImportModule.CONDUCTORS, ImportModule.DRIVERS, ImportModule.PARENTS].sort(),
    );
  });
});

describe('ImportTemplateService.buildTemplate', () => {
  it('builds an xlsx whose header row is exactly the definition', async () => {
    const file = await service.buildTemplate(ImportModule.STUDENTS, DataFileFormat.XLSX);

    assert.match(file.fileName, /^students_import_template_\d{4}-\d{2}-\d{2}\.xlsx$/);

    const parsed = await parseSpreadsheet(file.buffer, file.fileName, 1000);
    assert.deepEqual(
      parsed.headers,
      getImportDefinition(ImportModule.STUDENTS).columns.map((column) => column.header),
    );
  });

  it('ships a notes row and an example row that the admin is told to delete', async () => {
    const file = await service.buildTemplate(ImportModule.STUDENTS, DataFileFormat.XLSX);
    const parsed = await parseSpreadsheet(file.buffer, file.fileName, 1000);

    // Row 1 = notes, row 2 = the example record.
    assert.equal(parsed.rows.length, 2);
    assert.match(parsed.rows[0].values['admission number'], /Required\./);
    assert.equal(parsed.rows[1].values['admission number'], 'ST001');
  });

  it('builds a csv template with the header row and one example', async () => {
    const file = await service.buildTemplate(ImportModule.BUSES, DataFileFormat.CSV);

    assert.match(file.fileName, /\.csv$/);
    const parsed = await parseSpreadsheet(file.buffer, file.fileName, 1000);
    assert.deepEqual(
      parsed.headers,
      getImportDefinition(ImportModule.BUSES).columns.map((column) => column.header),
    );
    assert.equal(parsed.rows.length, 1);
  });

  it('builds a readable template for every module', async () => {
    for (const module of IMPORT_MODULE_ORDER) {
      const file = await service.buildTemplate(module, DataFileFormat.XLSX);
      const parsed = await parseSpreadsheet(file.buffer, file.fileName, 1000);
      assert.deepEqual(
        parsed.headers,
        getImportDefinition(module).columns.map((column) => column.header),
        `${module} template headers must match its definition`,
      );
    }
  });

  it('documents the allowed values of every enum-like column', async () => {
    const descriptor = service.describeModule(ImportModule.STUDENTS);
    const gender = descriptor.columns.find((column) => column.header === 'Gender');

    assert.deepEqual(gender?.allowed_values, ['MALE', 'FEMALE', 'OTHER']);
  });
});

describe('buildErrorWorkbook', () => {
  const definition = getImportDefinition(ImportModule.STUDENTS);

  const errors: ImportRowError[] = [
    {
      row_number: 3,
      status: ImportRowStatus.INVALID,
      issues: [
        { column: 'Last Name', message: 'Last name is required' },
        { column: 'Gender', message: 'Gender must be MALE, FEMALE or OTHER' },
      ],
      values: {
        'Admission Number': 'ST003',
        'First Name': 'Ada',
        'Last Name': '',
        Gender: 'ROBOT',
      },
    },
    {
      row_number: 7,
      status: ImportRowStatus.DUPLICATE_IN_FILE,
      issues: [{ column: null, message: 'Admission number repeats row 3 of this file' }],
      values: { 'Admission Number': 'ST003', 'First Name': 'Ada', 'Last Name': 'Lovelace' },
    },
  ];

  it('keeps every original column in its original position', async () => {
    const buffer = await buildErrorWorkbook(definition, errors);
    const parsed = await parseSpreadsheet(buffer, 'errors.xlsx', 1000);

    const expected = [
      'Row',
      ...definition.columns.map((column) => column.header),
      IMPORT_STATUS_COLUMN,
      ERROR_MESSAGE_COLUMN,
    ];
    assert.deepEqual(parsed.headers, expected);
  });

  it('echoes the values the admin typed so the file can be fixed in place', async () => {
    const buffer = await buildErrorWorkbook(definition, errors);
    const parsed = await parseSpreadsheet(buffer, 'errors.xlsx', 1000);

    const first = parsed.rows[0].values;
    assert.equal(first.row, '3');
    assert.equal(first['admission number'], 'ST003');
    assert.equal(first['first name'], 'Ada');
    assert.equal(first.gender, 'ROBOT');
  });

  it('joins every problem on a row into one Error Message cell', async () => {
    const buffer = await buildErrorWorkbook(definition, errors);
    const parsed = await parseSpreadsheet(buffer, 'errors.xlsx', 1000);

    const message = parsed.rows[0].values['error message'];
    assert.match(message, /Last Name: Last name is required/);
    assert.match(message, /Gender: Gender must be MALE, FEMALE or OTHER/);
  });

  it('spells out the status of each rejected row', async () => {
    const buffer = await buildErrorWorkbook(definition, errors);
    const parsed = await parseSpreadsheet(buffer, 'errors.xlsx', 1000);

    assert.equal(parsed.rows[0].values['import status'], 'Invalid');
    assert.equal(parsed.rows[1].values['import status'], 'Duplicate in file');
  });

  it('produces a headers-only workbook when there is nothing to report', async () => {
    const buffer = await buildErrorWorkbook(definition, []);
    const parsed = await parseSpreadsheet(buffer, 'errors.xlsx', 1000);

    assert.equal(parsed.rows.length, 0);
    assert.ok(parsed.headers.includes(ERROR_MESSAGE_COLUMN));
  });
});

describe('formatIssues', () => {
  it('prefixes column-scoped issues and leaves row-level ones bare', () => {
    const formatted = formatIssues({
      row_number: 1,
      status: ImportRowStatus.INVALID,
      issues: [
        { column: 'Gender', message: 'must be MALE, FEMALE or OTHER' },
        { column: null, message: 'this row duplicates row 4' },
      ],
      values: {},
    });

    assert.equal(formatted, 'Gender: must be MALE, FEMALE or OTHER\nthis row duplicates row 4');
  });
});

describe('errorFileName', () => {
  it('appends the suffix the requirement specifies', () => {
    assert.equal(errorFileName('students.xlsx'), 'students_import_errors.xlsx');
    assert.equal(errorFileName('term-1 roster.csv'), 'term-1 roster_import_errors.xlsx');
  });

  it('handles a name with no extension and an empty name', () => {
    assert.equal(errorFileName('roster'), 'roster_import_errors.xlsx');
    assert.equal(errorFileName(''), 'import_import_errors.xlsx');
  });

  it('always produces an xlsx, even for a csv upload', () => {
    // The error file needs two appended columns and readable wrapping, which a
    // CSV cannot carry; it is always a workbook.
    assert.match(errorFileName('roster.csv'), /\.xlsx$/);
  });
});
