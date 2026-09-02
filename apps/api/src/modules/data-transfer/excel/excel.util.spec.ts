import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { DataFileFormat } from '@school-bus-tracking/shared-types';
import {
  EXPORT_PAGE_SIZE,
  SpreadsheetParseError,
  SpreadsheetRowLimitError,
  buildCsv,
  buildWorkbookBuffer,
  cellToText,
  downloadFileName,
  normalizeHeader,
  parseSpreadsheet,
  sanitizeFileName,
  writeCsvToStream,
  writeXlsxToStream,
  type SheetCell,
  type StreamSink,
} from './excel.util';

/**
 * A real writable stream that buffers everything written to it.
 *
 * ExcelJS pipes its zip archiver into the sink, so a plain `{ write, end }`
 * object is not enough — the sink has to be an actual `Writable`, exactly as
 * an Express response is in production.
 */
function collectingSink(): StreamSink & { body(): Promise<Buffer> } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  return Object.assign(stream, {
    async body(): Promise<Buffer> {
      if (!stream.writableEnded) {
        await new Promise<void>((resolve) => stream.end(resolve));
      }
      return Buffer.concat(chunks);
    },
  });
}

/** Builds a CSV upload buffer from a header row plus data rows. */
function csvUpload(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.join(',')).join('\r\n'), 'utf8');
}

describe('normalizeHeader', () => {
  it('collapses the cosmetic differences admins actually introduce', () => {
    const expected = 'admission number';
    assert.equal(normalizeHeader('Admission Number'), expected);
    assert.equal(normalizeHeader('  admission   number  '), expected);
    assert.equal(normalizeHeader('Admission_Number'), expected);
    assert.equal(normalizeHeader('Admission-Number'), expected);
    assert.equal(normalizeHeader('Admission Number*'), expected);
  });

  it('keeps genuinely different headers distinct', () => {
    assert.notEqual(normalizeHeader('First Name'), normalizeHeader('Last Name'));
  });
});

describe('cellToText', () => {
  it('flattens every cell shape ExcelJS can hand back', () => {
    assert.equal(cellToText(null), '');
    assert.equal(cellToText(undefined), '');
    assert.equal(cellToText('  ST001 '), '  ST001 ');
    assert.equal(cellToText(42), '42');
    assert.equal(cellToText(true), 'true');
    assert.equal(cellToText(new Date('2026-03-01T00:00:00.000Z')), '2026-03-01T00:00:00.000Z');
    assert.equal(cellToText({ text: 'linked', hyperlink: 'mailto:a@b.c' }), 'linked');
    assert.equal(cellToText({ result: 7 }), '7');
    assert.equal(
      cellToText({ richText: [{ text: 'Ada ' }, { text: 'Lovelace' }] }),
      'Ada Lovelace',
    );
  });

  it('surfaces formula errors rather than swallowing them as empty', () => {
    // A silently-empty #REF! would import as "field missing", which hides the
    // real problem from the admin.
    assert.equal(cellToText({ error: '#REF!' }), '#REF!');
  });
});

describe('parseSpreadsheet', () => {
  it('reads a CSV upload into normalised headers and 1-based data rows', async () => {
    const sheet = await parseSpreadsheet(
      csvUpload([
        ['Admission Number', 'First Name'],
        ['ST001', 'Ada'],
        ['ST002', 'Grace'],
      ]),
      'students.csv',
      100,
    );

    assert.deepEqual(sheet.headers, ['Admission Number', 'First Name']);
    assert.equal(sheet.rows.length, 2);
    assert.equal(sheet.rows[0].rowNumber, 1);
    assert.deepEqual(sheet.rows[0].values, { 'admission number': 'ST001', 'first name': 'Ada' });
    assert.equal(sheet.rows[1].rowNumber, 2);
  });

  it('round-trips a generated xlsx workbook', async () => {
    const buffer = await buildWorkbookBuffer([
      {
        sheetName: 'Students',
        columns: [{ header: 'Admission Number' }, { header: 'First Name' }],
        rows: [['ST001', 'Ada']],
      },
    ]);

    const sheet = await parseSpreadsheet(buffer, 'students.xlsx', 100);
    assert.deepEqual(sheet.headers, ['Admission Number', 'First Name']);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0].values['admission number'], 'ST001');
  });

  it('drops blank rows without shifting the numbers of the rows that follow', async () => {
    const sheet = await parseSpreadsheet(
      csvUpload([['Code'], ['R1'], ['   '], ['R2']]),
      'routes.csv',
      100,
    );

    assert.equal(sheet.rows.length, 2);
    assert.deepEqual(
      sheet.rows.map((row) => [row.rowNumber, row.values.code]),
      [
        [1, 'R1'],
        [3, 'R2'],
      ],
    );
  });

  it('rejects a file with no header row', async () => {
    await assert.rejects(
      () => parseSpreadsheet(csvUpload([[''], ['ST001']]), 'students.csv', 100),
      SpreadsheetParseError,
    );
  });

  it('rejects a file that is not a spreadsheet at all', async () => {
    await assert.rejects(
      () => parseSpreadsheet(Buffer.from('%PDF-1.4 not a workbook'), 'students.xlsx', 100),
      SpreadsheetParseError,
    );
  });

  it('stops as soon as the row cap is exceeded', async () => {
    const rows = [['Code'], ...Array.from({ length: 6 }, (_, index) => [`R${index}`])];

    await assert.rejects(
      () => parseSpreadsheet(csvUpload(rows), 'routes.csv', 5),
      (error: unknown) => {
        assert.ok(error instanceof SpreadsheetRowLimitError);
        assert.equal(error.limit, 5);
        assert.match(error.message, /more than 5 rows/);
        return true;
      },
    );
  });
});

describe('buildCsv', () => {
  it('escapes quotes, commas and newlines per RFC 4180', () => {
    const csv = buildCsv(
      [{ header: 'Name' }, { header: 'Note' }],
      [
        ['Ada, Lovelace', 'She said "hi"'],
        ['Grace', 'line one\nline two'],
      ],
    ).toString('utf8');

    assert.match(csv, /"Ada, Lovelace","She said ""hi"""/);
    assert.match(csv, /"line one\nline two"/);
  });

  it('starts with a BOM so Excel opens UTF-8 correctly', () => {
    assert.ok(
      buildCsv([{ header: 'Name' }], [['Ünal']])
        .toString('utf8')
        .startsWith('\uFEFF'),
    );
  });

  it('renders booleans and nulls as spreadsheet-friendly text', () => {
    const csv = buildCsv(
      [{ header: 'Active' }, { header: 'Note' }],
      [
        [true, null],
        [false, ''],
      ],
    );
    const lines = csv.toString('utf8').trim().split('\r\n');
    assert.equal(lines[1], 'TRUE,');
    assert.equal(lines[2], 'FALSE,');
  });
});

describe('writeCsvToStream', () => {
  it('pages through the loader and reports the row count', async () => {
    const total = EXPORT_PAGE_SIZE + 7;
    const requested: Array<{ offset: number; limit: number }> = [];
    const sink = collectingSink();

    const written = await writeCsvToStream(
      sink,
      { sheetName: 'Students', columns: [{ header: 'Code' }] },
      async (offset, limit) => {
        requested.push({ offset, limit });
        const remaining = Math.max(0, total - offset);
        return Array.from({ length: Math.min(limit, remaining) }, (_, index) => [
          `R${offset + index}`,
        ]) as SheetCell[][];
      },
    );

    assert.equal(written, total);
    // Two pages: a full one and the short tail that ends the loop.
    assert.deepEqual(requested, [
      { offset: 0, limit: EXPORT_PAGE_SIZE },
      { offset: EXPORT_PAGE_SIZE, limit: EXPORT_PAGE_SIZE },
    ]);

    const text = (await sink.body()).toString('utf8');
    assert.ok(text.startsWith('\uFEFF'), 'CSV must lead with a BOM so Excel detects UTF-8');
    const lines = text.slice(1).trim().split('\r\n');
    assert.equal(lines.length, total + 1);
    assert.equal(lines[0], 'Code');
    assert.equal(lines[1], 'R0');
  });

  it('writes a header-only file when nothing matches the filters', async () => {
    const sink = collectingSink();
    const written = await writeCsvToStream(
      sink,
      { sheetName: 'Students', columns: [{ header: 'Code' }] },
      async () => [],
    );

    assert.equal(written, 0);
    assert.equal((await sink.body()).toString('utf8'), '\uFEFFCode\r\n');
  });
});

describe('writeXlsxToStream', () => {
  it('streams a workbook that parses back with every row', async () => {
    const sink = collectingSink();
    const written = await writeXlsxToStream(
      sink,
      { sheetName: 'Students', columns: [{ header: 'Code' }, { header: 'Name' }] },
      async (offset) =>
        offset === 0
          ? ([
              ['R1', 'Ada'],
              ['R2', 'Grace'],
            ] as SheetCell[][])
          : [],
    );

    assert.equal(written, 2);
    const parsed = await parseSpreadsheet(await sink.body(), 'export.xlsx', 100);
    assert.deepEqual(parsed.headers, ['Code', 'Name']);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[1].values.name, 'Grace');
  });
});

describe('sanitizeFileName', () => {
  it('strips directory traversal from a client-supplied name', () => {
    assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFileName('C:\\Users\\admin\\students.xlsx'), 'students.xlsx');
  });

  it('removes control characters and quotes that would break Content-Disposition', () => {
    assert.equal(sanitizeFileName('stu"dents\r\n.xlsx'), 'students.xlsx');
  });

  it('falls back when nothing usable remains', () => {
    assert.equal(sanitizeFileName('   ', 'upload'), 'upload');
    assert.equal(sanitizeFileName('/'), 'upload');
  });

  it('caps the length so a hostile name cannot bloat the header', () => {
    assert.equal(sanitizeFileName('a'.repeat(400)).length, 255);
  });
});

describe('downloadFileName', () => {
  it('stamps the date and the format onto the base name', () => {
    const date = new Date('2026-09-02T10:30:00.000Z');
    assert.equal(
      downloadFileName('students', DataFileFormat.XLSX, date),
      'students_2026-09-02.xlsx',
    );
    assert.equal(downloadFileName('students', DataFileFormat.CSV, date), 'students_2026-09-02.csv');
  });
});
