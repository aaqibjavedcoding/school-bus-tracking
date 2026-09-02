import { Op } from 'sequelize';
import type {
  ReportCategory,
  ReportColumn,
  ReportFilterKey,
  ReportQuery,
  ReportSummaryCard,
  ReportType,
} from '@school-bus-tracking/shared-types';
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
} from '../../database/models';

/** One row of a report result; values are already display-formatted. */
export type ReportRow = Record<string, string | number | null>;

/** Models the reports read from. Reports never write. */
export interface ReportRepositories {
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

/** What a report produced for one request. */
export interface ReportResult {
  summary: ReportSummaryCard[];
  rows: ReportRow[];
  /** Total matching rows, before pagination. */
  total: number;
}

/**
 * A report definition.
 *
 * Reports are read-only aggregations over the tenant's own tables. There is no
 * caching layer and no materialised state: every number is computed from the
 * live database at request time, so a report can never disagree with the screen
 * an admin was just looking at.
 */
export interface ReportDefinition {
  report: ReportType;
  label: string;
  description: string;
  category: ReportCategory;
  /** Filters this report honours; the UI renders exactly these inputs. */
  filters: ReportFilterKey[];
  columns: ReportColumn[];
  /** Base of the exported file name (a date stamp is appended). */
  fileBase: string;
  run(
    repositories: ReportRepositories,
    schoolId: string,
    query: ReportQuery,
    pagination: { offset: number; limit: number },
  ): Promise<ReportResult>;
}

/** Convenience constructor for a summary card. */
export function card(
  key: string,
  label: string,
  value: number,
  hint?: string | null,
): ReportSummaryCard {
  return { key, label, value, hint: hint ?? null };
}

/** Inclusive `YYYY-MM-DD` range clause over a timestamp column. */
export function dateRange(
  dateFrom: string | undefined,
  dateTo: string | undefined,
): Record<symbol, Date> | null {
  if (!dateFrom && !dateTo) {
    return null;
  }
  const range: Record<symbol, Date> = {};
  if (dateFrom) {
    range[Op.gte] = new Date(`${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    range[Op.lt] = new Date(new Date(`${dateTo}T00:00:00.000Z`).getTime() + 86_400_000);
  }
  return range;
}

/** Escapes LIKE wildcards so a search term is matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Applies offset/limit to an already-aggregated in-memory row set. */
export function paginateRows(rows: ReportRow[], offset: number, limit: number): ReportRow[] {
  return rows.slice(offset, offset + limit);
}

/** Percentage helper that never divides by zero. */
export function percentage(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.round((part / whole) * 1000) / 10;
}

/** `YYYY-MM-DD` from a timestamp. */
export function isoDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD HH:MM` from a timestamp. */
export function isoDateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16).replace('T', ' ');
}
