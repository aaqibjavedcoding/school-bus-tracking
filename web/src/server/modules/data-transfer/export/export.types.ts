import { Op, type WhereOptions } from 'sequelize';
import type { ExportDataset, ExportQuery } from '@school-bus-tracking/shared-types';
import type { SheetCell, SheetColumn } from '../excel/excel.util';
import type {
  Bus,
  BusDocument,
  DriverDocument,
  Notification,
  Route,
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripStudentAttendance,
  User,
} from '../../../database/models';

/** Models the export datasets read from. Read-only by construction. */
export interface ExportRepositories {
  students: typeof Student;
  guardians: typeof StudentGuardian;
  users: typeof User;
  buses: typeof Bus;
  routes: typeof Route;
  stops: typeof Stop;
  assignments: typeof RouteAssignment;
  trips: typeof Trip;
  attendance: typeof TripStudentAttendance;
  notifications: typeof Notification;
  busDocuments: typeof BusDocument;
  driverDocuments: typeof DriverDocument;
}

/** Loads one page of already-formatted rows. */
export type ExportPageLoader = (offset: number, limit: number) => Promise<SheetCell[][]>;

/** A dataset prepared for one specific request. */
export interface PreparedExport {
  /** Total matching records, used for the audit trail and the empty case. */
  total: number;
  /** Streams the rows page by page so a 10 000-row export stays memory-flat. */
  loadPage: ExportPageLoader;
}

/**
 * One exportable dataset.
 *
 * A dataset is deliberately *not* a mirror of a table: it is the set of
 * business-meaningful columns an admin would put in a spreadsheet. Password
 * hashes, verification timestamps, raw foreign keys, soft-delete markers and
 * anything else internal never appear — see each definition's column list.
 */
export interface ExportDefinition {
  dataset: ExportDataset;
  label: string;
  /** Base of the generated file name (a date stamp is appended). */
  fileBase: string;
  columns: SheetColumn[];
  /** Filters this dataset actually honours, for the audit metadata. */
  supportedFilters: Array<keyof ExportQuery>;
  prepare(
    repositories: ExportRepositories,
    schoolId: string,
    query: ExportQuery,
  ): Promise<PreparedExport>;
}

/**
 * Escapes `%` and `_` so a search term is matched literally.
 *
 * Same helper the list services use; duplicated locally for the same reason
 * they duplicate it — it is three lines and keeps modules independent.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Builds an `iLIKE %term%` clause over several columns. */
export function searchClause(search: string | undefined, columns: string[]): WhereOptions[] {
  if (!search) {
    return [];
  }
  const pattern = `%${escapeLikePattern(search)}%`;
  return [{ [Op.or]: columns.map((column) => ({ [column]: { [Op.iLike]: pattern } })) }];
}

/**
 * Turns `status=active|inactive` into an `is_active` clause.
 *
 * Anything else is ignored rather than rejected: the export mirrors whatever
 * the list screen sent, and an unknown status simply means "no filter".
 */
export function activeClause(status: string | undefined): Record<string, unknown> {
  if (status === 'active') return { is_active: true };
  if (status === 'inactive') return { is_active: false };
  return {};
}

/** Inclusive `YYYY-MM-DD` range clause on a timestamp column. */
export function dateRangeClause(
  column: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): Record<string, unknown> {
  if (!dateFrom && !dateTo) {
    return {};
  }
  const range: Record<symbol, Date> = {};
  if (dateFrom) {
    range[Op.gte] = new Date(`${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    // `date_to` is inclusive, so the bound is the start of the following day.
    range[Op.lt] = new Date(new Date(`${dateTo}T00:00:00.000Z`).getTime() + 86_400_000);
  }
  return { [column]: range };
}

/** Formats a date for a spreadsheet cell (`YYYY-MM-DD HH:MM`, UTC). */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/** Formats a date-only value (`YYYY-MM-DD`). */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

/** Spreadsheet-friendly boolean. */
export function formatBoolean(value: boolean | null | undefined): string {
  return value ? 'Yes' : 'No';
}

/** Never emits `null`; blank cells read better than the word "null". */
export function text(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}
