import {
  DataFileFormat,
  ImportRowStatus,
  type ImportRowError,
} from '@school-bus-tracking/shared-types';
import { buildWorkbookBuffer, type SheetCell } from '../excel/excel.util';
import type { ImportDefinition } from './import.types';

/** Column added to the right of the original data in the error workbook. */
export const IMPORT_STATUS_COLUMN = 'Import Status';

/** Column carrying every problem found on the row, newline separated. */
export const ERROR_MESSAGE_COLUMN = 'Error Message';

/** Human wording of a row status, as written into the error workbook. */
const STATUS_LABELS: Record<ImportRowStatus, string> = {
  [ImportRowStatus.VALID]: 'Valid',
  [ImportRowStatus.INVALID]: 'Invalid',
  [ImportRowStatus.DUPLICATE_IN_FILE]: 'Duplicate in file',
  [ImportRowStatus.EXISTS]: 'Already exists',
  [ImportRowStatus.WILL_UPDATE]: 'Will update',
  [ImportRowStatus.CREATED]: 'Created',
  [ImportRowStatus.UPDATED]: 'Updated',
  [ImportRowStatus.SKIPPED]: 'Skipped',
};

/**
 * Builds the `<file>_import_errors.xlsx` workbook.
 *
 * The point of this file is that an admin can fix it *in place*: every original
 * column keeps its position and its value, and two columns are appended on the
 * right. Deleting those two columns turns the corrected file straight back into
 * a valid upload — no re-keying, no hunting for row numbers.
 */
export function buildErrorWorkbook(
  definition: ImportDefinition,
  errors: ImportRowError[],
): Promise<Buffer> {
  const dataColumns = definition.columns.map((column) => column.header);

  const columns = [
    { header: 'Row', width: 8 },
    ...dataColumns.map((header) => ({
      header,
      width: Math.min(40, Math.max(16, header.length + 6)),
    })),
    { header: IMPORT_STATUS_COLUMN, width: 20 },
    { header: ERROR_MESSAGE_COLUMN, width: 70 },
  ];

  const rows: SheetCell[][] = errors.map((error) => [
    error.row_number,
    ...dataColumns.map((header) => error.values[header] ?? ''),
    STATUS_LABELS[error.status] ?? String(error.status),
    formatIssues(error),
  ]);

  return buildWorkbookBuffer([
    {
      sheetName: 'Errors',
      columns,
      rows,
    },
  ]);
}

/**
 * Joins every problem on a row into one cell.
 *
 * A row is rarely wrong in exactly one way, and reporting only the first error
 * turns a single fix-and-retry cycle into five. Column-scoped issues are
 * prefixed with their header so the admin knows where to look.
 */
export function formatIssues(error: ImportRowError): string {
  return error.issues
    .map((issue) => (issue.column ? `${issue.column}: ${issue.message}` : issue.message))
    .join('\n');
}

/** File name of the error workbook for an uploaded file. */
export function errorFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\.[^.]+$/, '') || 'import';
  return `${base}_import_errors.${DataFileFormat.XLSX}`;
}
