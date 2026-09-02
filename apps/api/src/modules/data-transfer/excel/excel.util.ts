import { Readable, Writable } from 'stream';
import * as ExcelJS from 'exceljs';
import { DataFileFormat } from '@school-bus-tracking/shared-types';

/**
 * Spreadsheet helpers shared by templates, imports, exports and reports.
 *
 * Everything here is built on `exceljs` (MIT, pure JavaScript, no native
 * bindings and no paid service). Two capabilities matter for a real school:
 *
 * - **Streaming writes** — `writeSheetToStream` pushes rows to the HTTP
 *   response through the ExcelJS streaming workbook writer, so a 10 000-row
 *   export never materialises a full workbook in memory.
 * - **Bounded reads** — the import parser refuses oversized files up front and
 *   stops as soon as a row cap is exceeded, so a hostile upload cannot exhaust
 *   the process.
 */

/** Column definition used by every generated sheet. */
export interface SheetColumn {
  /** Header text written into row 1. */
  header: string;
  /** Column width in characters; a sensible default is derived when omitted. */
  width?: number;
}

/** One row of an emitted sheet, keyed positionally against {@link SheetColumn}. */
export type SheetCell = string | number | boolean | null;

/** Maximum upload size accepted by the import endpoints (5 MB). */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** Extensions the import endpoints accept. */
export const IMPORT_ALLOWED_EXTENSIONS = ['.xlsx', '.csv'] as const;

/** MIME types a browser or Excel may attach to those extensions. */
export const IMPORT_ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'text/csv',
  'application/csv',
  'text/plain',
  '',
]);

/** Content type of each supported download format. */
export const FILE_CONTENT_TYPES: Record<DataFileFormat, string> = {
  [DataFileFormat.XLSX]: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  [DataFileFormat.CSV]: 'text/csv; charset=utf-8',
};

/** A parsed spreadsheet: normalised headers plus raw row values. */
export interface ParsedSheet {
  /** Headers exactly as they appeared in the file (trimmed). */
  headers: string[];
  /**
   * Data rows. Each entry maps a *normalised* header
   * (see {@link normalizeHeader}) to the raw cell text.
   */
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
}

/**
 * Canonical form of a header used for matching.
 *
 * Admins rename "Student Name" to "student name" or " Student  Name ", and
 * Excel silently keeps trailing spaces. Matching on a lowercase,
 * whitespace/punctuation-collapsed form makes the template forgiving about
 * cosmetics while still rejecting genuinely wrong columns.
 */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

/** Reduces any ExcelJS cell value to plain text. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const candidate = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
      error?: string;
    };
    if (Array.isArray(candidate.richText)) {
      return candidate.richText.map((part) => part.text ?? '').join('');
    }
    if (candidate.error) {
      // A formula error cell (#REF!, #VALUE!) must not silently become "".
      return String(candidate.error);
    }
    if (candidate.text !== undefined) {
      return cellToText(candidate.text);
    }
    if (candidate.result !== undefined) {
      return cellToText(candidate.result);
    }
    return '';
  }
  return String(value);
}

/** Raised when an uploaded file cannot be read as a spreadsheet at all. */
export class SpreadsheetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetParseError';
  }
}

/** Raised when a file carries more data rows than the module allows. */
export class SpreadsheetRowLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`The file contains more than ${limit} rows. Split it into smaller files and try again.`);
    this.name = 'SpreadsheetRowLimitError';
  }
}

/**
 * Parses an uploaded `.xlsx` or `.csv` buffer into headers + rows.
 *
 * Only the first worksheet is read: templates ship a single data sheet, and
 * silently merging extra sheets would import data the admin never reviewed.
 * Rows that are entirely blank are dropped — spreadsheets are full of them.
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  fileName: string,
  maxRows: number,
): Promise<ParsedSheet> {
  const isCsv = fileName.toLowerCase().endsWith('.csv');
  const workbook = new ExcelJS.Workbook();

  try {
    if (isCsv) {
      // `csv.read` expects a stream; the buffer is already bounded by the
      // upload limit so wrapping it is safe.
      await workbook.csv.read(Readable.from(buffer.toString('utf8')));
    } else {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    }
  } catch (error) {
    throw new SpreadsheetParseError(
      `The file could not be read as a ${isCsv ? 'CSV' : 'Excel'} document. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new SpreadsheetParseError('The file does not contain any worksheet.');
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = cellToText(cell.value).trim();
  });

  // Trailing empty header cells are an artefact of Excel's used range.
  while (headers.length > 0 && !headers[headers.length - 1]) {
    headers.pop();
  }
  if (headers.length === 0) {
    throw new SpreadsheetParseError('The first row of the file must contain column headers.');
  }

  const rows: ParsedSheet['rows'] = [];
  const lastRow = worksheet.rowCount;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: Record<string, string> = {};
    let hasContent = false;

    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (!header) continue;
      const text = cellToText(row.getCell(index + 1).value).trim();
      values[normalizeHeader(header)] = text;
      if (text.length > 0) {
        hasContent = true;
      }
    }

    if (!hasContent) {
      continue;
    }

    // `rowNumber - 1` is the 1-based *data* row an admin sees below the header.
    rows.push({ rowNumber: rowNumber - 1, values });

    if (rows.length > maxRows) {
      throw new SpreadsheetRowLimitError(maxRows);
    }
  }

  return { headers: headers.filter(Boolean), rows };
}

/** Options shared by the workbook builders. */
export interface SheetOptions {
  sheetName: string;
  columns: SheetColumn[];
  /**
   * Optional grey notes row inserted directly beneath the header, used by the
   * import templates to document each column inline.
   */
  notes?: string[];
  /** Freeze the header row so long sheets stay readable. */
  freezeHeader?: boolean;
}

/** Applies the shared header styling used by every generated sheet. */
function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3A5F' },
  };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

/** Applies the muted styling of the template notes row. */
function styleNotesRow(row: ExcelJS.Row): void {
  row.font = { italic: true, size: 9, color: { argb: 'FF5A6B7B' } };
  row.alignment = { vertical: 'top', wrapText: true };
}

/** Derives a readable column width when the caller did not pick one. */
function resolveWidth(column: SheetColumn): number {
  return column.width ?? Math.min(48, Math.max(14, column.header.length + 4));
}

/**
 * Builds a complete in-memory workbook.
 *
 * Used for small, bounded documents (templates, error reports): they are a few
 * hundred rows at most, so the simplicity is worth more than streaming.
 */
export async function buildWorkbookBuffer(
  sheets: Array<SheetOptions & { rows: SheetCell[][] }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'School Bus Tracking';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.sheetName);
    worksheet.columns = sheet.columns.map((column) => ({
      header: column.header,
      width: resolveWidth(column),
    }));
    styleHeaderRow(worksheet.getRow(1));

    if (sheet.notes) {
      styleNotesRow(worksheet.addRow(sheet.notes));
    }
    for (const row of sheet.rows) {
      worksheet.addRow(row);
    }
    if (sheet.freezeHeader !== false) {
      worksheet.views = [{ state: 'frozen', ySplit: sheet.notes ? 2 : 1 }];
    }
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(1, sheet.columns.length) },
    };
  }

  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}

/** Serialises rows to RFC 4180 CSV (with a BOM so Excel detects UTF-8). */
export function buildCsv(columns: SheetColumn[], rows: SheetCell[][]): Buffer {
  const lines = [columns.map((column) => escapeCsv(column.header)).join(',')];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsv(formatCell(cell))).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

function formatCell(cell: SheetCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return String(cell);
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Sink the streaming writers push bytes into.
 *
 * This is a real Node `Writable` rather than a hand-rolled `{ write, end }`
 * shape: ExcelJS pipes its archiver straight into the sink, so it needs the
 * full stream contract (`on`, `once`, `emit`, backpressure). An Express
 * response satisfies it as-is; tests use `new PassThrough()`.
 */
export type StreamSink = Writable;

/**
 * Supplies rows page by page.
 *
 * Returning batches (rather than a single array) is what keeps a 10 000-row
 * export off the heap: the writer flushes each page before asking for the
 * next one.
 */
export type RowPageLoader = (offset: number, limit: number) => Promise<SheetCell[][]>;

/** Rows fetched from the database per page while streaming an export. */
export const EXPORT_PAGE_SIZE = 500;

/**
 * Streams an `.xlsx` document to `sink`, pulling rows page by page.
 *
 * ExcelJS's `WorkbookWriter` commits each row as it is added, so peak memory
 * stays proportional to one page rather than to the dataset.
 */
export async function writeXlsxToStream(
  sink: StreamSink,
  sheet: SheetOptions,
  loadPage: RowPageLoader,
): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: sink,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'School Bus Tracking';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheet.sheetName);
  worksheet.columns = sheet.columns.map((column) => ({
    header: column.header,
    width: resolveWidth(column),
  }));
  styleHeaderRow(worksheet.getRow(1));
  worksheet.getRow(1).commit();

  let offset = 0;
  let written = 0;
  for (;;) {
    const page = await loadPage(offset, EXPORT_PAGE_SIZE);
    if (page.length === 0) {
      break;
    }
    for (const row of page) {
      worksheet.addRow(row).commit();
      written += 1;
    }
    offset += page.length;
    if (page.length < EXPORT_PAGE_SIZE) {
      break;
    }
  }

  worksheet.commit();
  await workbook.commit();
  return written;
}

/** Streams a CSV document to `sink`, pulling rows page by page. */
export async function writeCsvToStream(
  sink: StreamSink,
  sheet: SheetOptions,
  loadPage: RowPageLoader,
): Promise<number> {
  sink.write(`\uFEFF${sheet.columns.map((column) => escapeCsv(column.header)).join(',')}\r\n`);

  let offset = 0;
  let written = 0;
  for (;;) {
    const page = await loadPage(offset, EXPORT_PAGE_SIZE);
    if (page.length === 0) {
      break;
    }
    sink.write(
      `${page
        .map((row) => row.map((cell) => escapeCsv(formatCell(cell))).join(','))
        .join('\r\n')}\r\n`,
    );
    written += page.length;
    offset += page.length;
    if (page.length < EXPORT_PAGE_SIZE) {
      break;
    }
  }

  sink.end();
  return written;
}

/**
 * Strips path separators and control characters from a client-supplied
 * filename before it is echoed into `Content-Disposition` or persisted.
 */
export function sanitizeFileName(name: string, fallback = 'upload'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : fallback;
}

/** Builds a timestamped download name, e.g. `students_2026-09-02.xlsx`. */
export function downloadFileName(base: string, format: DataFileFormat, date = new Date()): string {
  return `${base}_${date.toISOString().slice(0, 10)}.${format}`;
}
