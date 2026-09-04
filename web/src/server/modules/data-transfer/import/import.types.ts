import type { Transaction } from 'sequelize';
import type { ZodType } from 'zod';
import type {
  ImportMode,
  ImportModule,
  ImportRowIssue,
  ImportTemplateColumn,
  PlanLimitResource,
} from '@school-bus-tracking/shared-types';
import type {
  Bus,
  Route,
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  User,
} from '../../../database/models';

/**
 * Repositories every import definition may use.
 *
 * They are the same Sequelize model classes the feature services inject, so an
 * import writes through the identical models, hooks and constraints as a form
 * submission — nothing bypasses the ORM or the database's unique indexes.
 */
export interface ImportRepositories {
  students: typeof Student;
  guardians: typeof StudentGuardian;
  users: typeof User;
  buses: typeof Bus;
  routes: typeof Route;
  stops: typeof Stop;
  assignments: typeof RouteAssignment;
}

/** A column of an import template, plus the schema key it feeds. */
export interface ImportColumnDefinition extends ImportTemplateColumn {
  /** Key produced by the row schema for this column. */
  field: string;
  /**
   * Marks a column whose raw cell value must never be retained.
   *
   * Import runs keep the original cells so the error workbook can be fixed in
   * place, but a credential column must not survive that round trip: it would
   * otherwise be written to `import_jobs.errors` and handed back in a
   * downloadable file. Values of these columns are replaced with
   * {@link REDACTED_CELL} before anything is stored.
   */
  sensitive?: boolean;
}

/** Placeholder written in place of a sensitive cell value. */
export const REDACTED_CELL = '[redacted]';

/** Outcome of resolving one row's references against the tenant's data. */
export interface ImportRowResolution {
  /** Reference / business problems found for this row. */
  issues: ImportRowIssue[];
  /** Values ready to be written; omitted when the row cannot be imported. */
  payload?: Record<string, unknown>;
  /** Id of the existing record matched by the natural key, when any. */
  existingId?: string | null;
}

/** A row that passed validation and is queued for writing. */
export interface ImportAcceptedRow {
  rowNumber: number;
  payload: Record<string, unknown>;
  existingId: string | null;
}

/**
 * A row that passed per-row resolution and is therefore a candidate for
 * writing. Batch-level validations that need to compare rows against each
 * other (period overlap conflicts, duplicate business rules across rows, …)
 * run against this list once the import mode is known.
 */
export interface ImportResolvedRow {
  rowNumber: number;
  /** Stable natural key of the row (unique inside the file). */
  key: string;
  parsed: unknown;
  payload: Record<string, unknown>;
  existingId: string | null;
}

/** Counters returned by a definition after it wrote its rows. */
export interface ImportPersistResult {
  created: number;
  updated: number;
}

/**
 * A definition's batch-scoped worker.
 *
 * Created once per import run *after* all rows are parsed, so lookups (routes
 * by code, existing admission numbers, parent accounts, …) can be loaded with
 * a handful of `IN (…)` queries instead of one query per row.
 */
export interface PreparedImport {
  /** Resolves references for one parsed row. */
  resolve(parsed: unknown, naturalKey: string): ImportRowResolution;
  /**
   * Optional batch-level validation run after every row has been resolved, now
   * that the import mode and the full set of accepted rows are known. Returns
   * extra row issues keyed by natural key; rows with issues are skipped like
   * any other invalid row.
   *
   * Modules whose rows only make sense relative to each other or to existing
   * records as a set (route assignments with overlapping effective periods)
   * implement this so a spreadsheet can never bypass the conflicts the
   * single-record endpoints enforce.
   */
  batchIssues?(
    rows: ImportResolvedRow[],
    mode: ImportMode,
  ): Promise<ReadonlyMap<string, ImportRowIssue[]>>;
  /** Writes the accepted rows. Always called inside a transaction. */
  persist(rows: ImportAcceptedRow[], transaction: Transaction): Promise<ImportPersistResult>;
  /**
   * Plan resources consumed by each *created* row. The import service reserves
   * the whole batch against these quotas before writing anything, so a bulk
   * upload can never take a school past the cap its plan allows.
   */
  planResources?: PlanLimitResource[];
}

/**
 * Everything the generic import pipeline needs to know about one module.
 *
 * Parsed rows are typed as `unknown` at this boundary so the registry can hold
 * heterogeneous definitions; each definition immediately narrows to its own
 * schema output, which is where the real typing lives.
 */
export interface ImportDefinition {
  module: ImportModule;
  label: string;
  /** Business meaning of one row, shown on the template's instructions sheet. */
  description: string;
  /** Human description of the duplicate-detection key. */
  naturalKeyLabel: string;
  /** Hard cap on data rows per file for this module. */
  maxRows: number;
  supportsUpsert: boolean;
  columns: ImportColumnDefinition[];
  /** Cell-level validation, reusing the shared Zod row schemas. */
  schema: ZodType<unknown>;
  /** Stable key used to detect duplicates and to match rows on upsert. */
  naturalKey(parsed: unknown): string;
  /** Short human label of the record, shown in the preview. */
  rowLabel(parsed: unknown): string;
  /** Loads batch lookups and returns the worker for this run. */
  prepare(
    repositories: ImportRepositories,
    schoolId: string,
    parsedRows: unknown[],
  ): Promise<PreparedImport>;
}

/** Convenience: a row-level issue attached to a specific column. */
export function issue(column: string | null, message: string): ImportRowIssue {
  return { column, message };
}

/** Chunk helper used by the bulk writers to keep statements a sane size. */
export function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

/** Rows written per `bulkCreate` statement. */
export const IMPORT_INSERT_CHUNK_SIZE = 200;
