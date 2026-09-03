import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { UniqueConstraintError, ValidationError as SequelizeValidationError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  ImportJobStatus,
  ImportMode,
  ImportModule,
  ImportRowStatus,
  IMPORT_MODULE_LABELS,
  type ImportCommitResponse,
  type ImportPreviewRow,
  type ImportRowError,
  type ImportRowIssue,
  type ImportSummary,
  type ImportValidationResponse,
} from '@school-bus-tracking/shared-types';
import { PlanLimitsService } from '../../../common/plan-limits';
import {
  AUDIT_ACTIONS,
  AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
  AUDIT_ENTITY_TYPES,
  type AssistedAuditContext,
  AuditService,
} from '../../audit';
import type {
  Bus,
  ImportJob,
  Route,
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  User,
} from '../../../database/models';
import {
  DATA_TRANSFER_ASSIGNMENTS_REPOSITORY,
  DATA_TRANSFER_BUSES_REPOSITORY,
  DATA_TRANSFER_GUARDIANS_REPOSITORY,
  DATA_TRANSFER_IMPORT_JOBS_REPOSITORY,
  DATA_TRANSFER_ROUTES_REPOSITORY,
  DATA_TRANSFER_SEQUELIZE,
  DATA_TRANSFER_STOPS_REPOSITORY,
  DATA_TRANSFER_STUDENTS_REPOSITORY,
  DATA_TRANSFER_USERS_REPOSITORY,
  IMPORT_FILE_EMPTY_MESSAGE,
  IMPORT_NOTHING_TO_IMPORT_MESSAGE,
  IMPORT_PREVIEW_LIMIT,
  IMPORT_STORED_ERROR_LIMIT,
} from '../data-transfer.constants';
import {
  SpreadsheetParseError,
  SpreadsheetRowLimitError,
  normalizeHeader,
  parseSpreadsheet,
} from '../excel/excel.util';
import { getImportDefinition } from './definitions';
import { REDACTED_CELL } from './import.types';
import type {
  ImportAcceptedRow,
  ImportDefinition,
  ImportRepositories,
  ImportResolvedRow,
  PreparedImport,
} from './import.types';

/** An uploaded file as handed over by the controller. */
export interface UploadedImportFile {
  originalName: string;
  buffer: Buffer;
}

/**
 * Metadata fragment marking an audit row as produced by the Super Admin
 * assisted-management surface and linking it to the open session. Emits
 * nothing for ordinary school-admin runs, whose metadata stays unchanged.
 */
function assistedMetadata(actor: ImportActor): Record<string, unknown> {
  if (!actor.context) {
    return {};
  }
  return {
    context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
    assisted_session_id: actor.context.assisted_session_id ?? null,
  };
}

/** Who is running the import (all values come from the verified JWT). */
export interface ImportActor {
  schoolId: string;
  userId: string;
  /**
   * Set only on the Super Admin assisted-management surface: links the audit
   * rows this run produces to the open assisted-management session. It never
   * changes *who* the actor is — the Super Admin stays the actor — nor which
   * school the rows target.
   */
  context?: AssistedAuditContext;
}

/** Per-row analysis produced before anything is written. */
interface AnalyzedRow {
  rowNumber: number;
  status: ImportRowStatus;
  label: string;
  issues: ImportRowIssue[];
  /** Raw cell values keyed by template header, kept for the error workbook. */
  values: Record<string, string>;
  payload?: Record<string, unknown>;
  existingId?: string | null;
}

/** Everything a validate run produced, reusable by commit. */
interface AnalysisResult {
  definition: ImportDefinition;
  prepared: PreparedImport | null;
  rows: AnalyzedRow[];
  summary: ImportSummary;
  unknownColumns: string[];
  missingColumns: string[];
}

/**
 * The bulk import engine.
 *
 * ## Flow
 *
 * 1. **Parse** the upload into headers + raw cell text.
 * 2. **Map** headers to the module's template columns (case and punctuation
 *    insensitive), reporting unknown and missing columns instead of guessing.
 * 3. **Validate** every cell with the module's shared Zod row schema — the very
 *    same schemas the single-record endpoints use, so an import can never write
 *    a value a form would have rejected.
 * 4. **Resolve** references (route codes, parent emails, …) with batched
 *    tenant-pinned lookups, detect duplicates both inside the file and against
 *    the database, and run the module's batch-level conflict checks (so a
 *    spreadsheet cannot bypass the single-record endpoints' overlap rules).
 * 5. **Report** every row's outcome. Nothing is ever skipped silently.
 * 6. On commit only: **write** the accepted rows inside one transaction, after
 *    reserving the school's plan capacity for the whole batch.
 *
 * ## Why commit re-parses the file
 *
 * Commit takes the file again rather than a server-side draft id. Storing the
 * uploaded bytes would mean holding a school's full roster — names, phone
 * numbers, medical notes — on disk with no retention story, for the sake of
 * saving one parse. Re-validating on commit is also what makes the write safe:
 * the database may have changed between preview and confirmation, and only a
 * fresh validation inside the same request can see that.
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);
  private readonly repositories: ImportRepositories;

  constructor(
    @Inject(DATA_TRANSFER_STUDENTS_REPOSITORY) students: typeof Student,
    @Inject(DATA_TRANSFER_GUARDIANS_REPOSITORY) guardians: typeof StudentGuardian,
    @Inject(DATA_TRANSFER_USERS_REPOSITORY) users: typeof User,
    @Inject(DATA_TRANSFER_BUSES_REPOSITORY) buses: typeof Bus,
    @Inject(DATA_TRANSFER_ROUTES_REPOSITORY) routes: typeof Route,
    @Inject(DATA_TRANSFER_STOPS_REPOSITORY) stops: typeof Stop,
    @Inject(DATA_TRANSFER_ASSIGNMENTS_REPOSITORY) assignments: typeof RouteAssignment,
    @Inject(DATA_TRANSFER_IMPORT_JOBS_REPOSITORY) private readonly importJobs: typeof ImportJob,
    private readonly planLimits: PlanLimitsService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(DATA_TRANSFER_SEQUELIZE)
    private readonly sequelize?: Sequelize | null,
  ) {
    this.repositories = { students, guardians, users, buses, routes, stops, assignments };
  }

  /**
   * Dry run: parses, validates and reports without writing anything.
   *
   * The result is persisted as a `VALIDATED` job so the error workbook stays
   * downloadable after the admin has closed the wizard.
   */
  async validate(
    actor: ImportActor,
    module: ImportModule,
    mode: ImportMode,
    file: UploadedImportFile,
  ): Promise<ImportValidationResponse> {
    const analysis = await this.analyze(actor.schoolId, module, mode, file);
    const job = await this.recordJob(actor, module, mode, file, analysis, {
      status: ImportJobStatus.VALIDATED,
      dryRun: true,
      created: 0,
      updated: 0,
      failureReason: null,
    });

    await this.audit.log({
      school_id: actor.schoolId,
      actor_user_id: actor.userId,
      action: AUDIT_ACTIONS.IMPORT_VALIDATE,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: job?.id ?? null,
      metadata: {
        module,
        mode,
        file_name: file.originalName,
        ...analysis.summary,
        ...assistedMetadata(actor),
      },
    });

    return this.toValidationResponse(job?.id ?? '', module, mode, file, analysis);
  }

  /**
   * Writes the valid rows of the file.
   *
   * All-or-nothing at the *batch* level: the accepted rows are written in one
   * transaction, so a failure halfway through leaves the school's data exactly
   * as it was. Rows the admin was already told about (invalid, duplicate,
   * already existing) are reported as skipped — they never block the rows that
   * are fine, which is the whole point of "Import valid records".
   */
  async commit(
    actor: ImportActor,
    module: ImportModule,
    mode: ImportMode,
    file: UploadedImportFile,
  ): Promise<ImportCommitResponse> {
    const analysis = await this.analyze(actor.schoolId, module, mode, file);

    const accepted: ImportAcceptedRow[] = analysis.rows
      .filter(
        (row) =>
          (row.status === ImportRowStatus.VALID || row.status === ImportRowStatus.WILL_UPDATE) &&
          row.payload,
      )
      .map((row) => ({
        rowNumber: row.rowNumber,
        payload: row.payload as Record<string, unknown>,
        existingId: row.existingId ?? null,
      }));

    if (accepted.length === 0) {
      // Persist the run anyway: the admin still needs the error file.
      const job = await this.recordJob(actor, module, mode, file, analysis, {
        status: ImportJobStatus.FAILED,
        dryRun: false,
        created: 0,
        updated: 0,
        failureReason: IMPORT_NOTHING_TO_IMPORT_MESSAGE,
      });
      await this.auditCommit(actor, module, mode, file, analysis, job?.id ?? null, false);
      throw new BadRequestException({
        message: IMPORT_NOTHING_TO_IMPORT_MESSAGE,
        details: {
          job_id: job?.id ?? null,
          summary: analysis.summary,
          has_error_file: analysis.rows.some((row) => row.issues.length > 0),
        },
      });
    }

    const creations = accepted.filter((row) => !row.existingId).length;
    const prepared = analysis.prepared as PreparedImport;

    let created = 0;
    let updated = 0;
    let failureReason: string | null = null;
    let status = ImportJobStatus.COMPLETED;

    try {
      // One transaction for the whole batch, opened by the plan-limit
      // reservation so the capacity check and the inserts share a snapshot.
      const result = await this.planLimits.runWithinBulkLimit(
        actor.schoolId,
        prepared.planResources ?? [],
        creations,
        async (transaction) => {
          if (!transaction) {
            // Only reachable when the app runs without a Sequelize instance
            // (unit tests with stub repositories).
            return prepared.persist(accepted, undefined as never);
          }
          return prepared.persist(accepted, transaction);
        },
      );
      created = result.created;
      updated = result.updated;
    } catch (error) {
      status = ImportJobStatus.FAILED;
      failureReason = this.describeFailure(error);
      created = 0;
      updated = 0;

      const job = await this.recordJob(actor, module, mode, file, analysis, {
        status,
        dryRun: false,
        created: 0,
        updated: 0,
        failureReason,
      });
      await this.auditCommit(actor, module, mode, file, analysis, job?.id ?? null, false);

      this.logger.warn(
        `Import ${module} rolled back for school ${actor.schoolId}: ${failureReason}`,
      );

      // Plan-limit and conflict errors already carry the right HTTP shape.
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException({
          message: failureReason,
          details: { job_id: job?.id ?? null, summary: analysis.summary },
        });
      }
      throw error;
    }

    // Re-label the rows that actually made it, so the result screen and the
    // stored history agree with the database.
    for (const row of analysis.rows) {
      if (row.status === ImportRowStatus.VALID) {
        row.status = ImportRowStatus.CREATED;
      } else if (row.status === ImportRowStatus.WILL_UPDATE) {
        row.status = ImportRowStatus.UPDATED;
      }
    }

    const job = await this.recordJob(actor, module, mode, file, analysis, {
      status,
      dryRun: false,
      created,
      updated,
      failureReason: null,
    });
    await this.auditCommit(actor, module, mode, file, analysis, job?.id ?? null, true, {
      created,
      updated,
    });

    const base = this.toValidationResponse(job?.id ?? '', module, mode, file, analysis);

    return {
      ...base,
      status,
      created_count: created,
      updated_count: updated,
      skipped_count: analysis.summary.rows_to_skip,
      failure_reason: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  /**
   * Parses and fully evaluates the file without writing anything.
   *
   * Shared by validate and commit, which is what guarantees the preview an
   * admin approved describes the same decisions the commit will make.
   */
  private async analyze(
    schoolId: string,
    module: ImportModule,
    mode: ImportMode,
    file: UploadedImportFile,
  ): Promise<AnalysisResult> {
    const definition = getImportDefinition(module);

    let sheet;
    try {
      sheet = await parseSpreadsheet(file.buffer, file.originalName, definition.maxRows);
    } catch (error) {
      if (error instanceof SpreadsheetRowLimitError || error instanceof SpreadsheetParseError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // --- Header mapping -----------------------------------------------------
    const presentHeaders = new Set(sheet.headers.map((header) => normalizeHeader(header)));
    const knownHeaders = new Map(
      definition.columns.map((column) => [normalizeHeader(column.header), column]),
    );

    const missingColumns = definition.columns
      .filter((column) => column.required && !presentHeaders.has(normalizeHeader(column.header)))
      .map((column) => column.header);

    const unknownColumns = sheet.headers.filter(
      (header) => header && !knownHeaders.has(normalizeHeader(header)),
    );

    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `The file is missing required column${missingColumns.length > 1 ? 's' : ''}: ` +
          `${missingColumns.join(', ')}. Download the template and keep its header row.`,
      );
    }

    if (sheet.rows.length === 0) {
      throw new BadRequestException(IMPORT_FILE_EMPTY_MESSAGE);
    }

    // --- Cell validation ----------------------------------------------------
    interface Candidate {
      rowNumber: number;
      values: Record<string, string>;
      parsed?: unknown;
      issues: ImportRowIssue[];
    }

    const candidates: Candidate[] = sheet.rows.map((row) => {
      // Only template columns are read: an extra column in the file is
      // reported, never written.
      const input: Record<string, string> = {};
      const values: Record<string, string> = {};
      for (const column of definition.columns) {
        const raw = row.values[normalizeHeader(column.header)] ?? '';
        // `input` feeds validation and is discarded with the request.
        // `values` is retained (history + error workbook), so a credential
        // column is redacted here rather than at each consumer.
        input[column.field] = raw;
        values[column.header] = column.sensitive && raw ? REDACTED_CELL : raw;
      }

      const result = definition.schema.safeParse(input);
      if (result.success) {
        return { rowNumber: row.rowNumber, values, parsed: result.data, issues: [] };
      }

      return {
        rowNumber: row.rowNumber,
        values,
        issues: this.zodIssues(result.error, definition),
      };
    });

    // --- Reference resolution + duplicate detection -------------------------
    const parsedRows = candidates
      .filter((candidate) => candidate.parsed !== undefined)
      .map((candidate) => candidate.parsed);

    const prepared =
      parsedRows.length > 0
        ? await definition.prepare(this.repositories, schoolId, parsedRows)
        : null;

    const seenKeys = new Map<string, number>();
    const rows: AnalyzedRow[] = [];
    // Rows that cleared per-row resolution, kept for the optional batch-level
    // validation pass (`PreparedImport.batchIssues`) that runs once the import
    // mode and the full accepted set are known.
    const resolvedCandidates: ImportResolvedRow[] = [];
    const keyByRowNumber = new Map<number, string>();

    for (const candidate of candidates) {
      if (candidate.parsed === undefined) {
        rows.push({
          rowNumber: candidate.rowNumber,
          status: ImportRowStatus.INVALID,
          label: this.fallbackLabel(candidate.values),
          issues: candidate.issues,
          values: candidate.values,
        });
        continue;
      }

      const parsed = candidate.parsed;
      const key = definition.naturalKey(parsed);
      const label = definition.rowLabel(parsed);

      const firstSeenAt = seenKeys.get(key);
      if (firstSeenAt !== undefined) {
        rows.push({
          rowNumber: candidate.rowNumber,
          status: ImportRowStatus.DUPLICATE_IN_FILE,
          label,
          issues: [
            {
              column: null,
              message: `${definition.naturalKeyLabel} repeats row ${firstSeenAt} of this file; only the first occurrence is imported`,
            },
          ],
          values: candidate.values,
        });
        continue;
      }
      seenKeys.set(key, candidate.rowNumber);

      const resolution = prepared!.resolve(parsed, key);
      if (resolution.issues.length > 0) {
        rows.push({
          rowNumber: candidate.rowNumber,
          status: ImportRowStatus.INVALID,
          label,
          issues: resolution.issues,
          values: candidate.values,
        });
        continue;
      }

      const existingId = resolution.existingId ?? null;

      if (existingId && mode === ImportMode.CREATE) {
        rows.push({
          rowNumber: candidate.rowNumber,
          status: ImportRowStatus.EXISTS,
          label,
          issues: [
            {
              column: null,
              message: `A record with this ${definition.naturalKeyLabel.toLowerCase()} already exists. Re-run the import in "update existing" mode to overwrite it.`,
            },
          ],
          values: candidate.values,
          existingId,
        });
        continue;
      }

      rows.push({
        rowNumber: candidate.rowNumber,
        status: existingId ? ImportRowStatus.WILL_UPDATE : ImportRowStatus.VALID,
        label,
        issues: [],
        values: candidate.values,
        payload: resolution.payload,
        existingId,
      });
      resolvedCandidates.push({
        rowNumber: candidate.rowNumber,
        key,
        parsed,
        payload: resolution.payload as Record<string, unknown>,
        existingId,
      });
      keyByRowNumber.set(candidate.rowNumber, key);
    }

    // Batch-level conflicts (e.g. overlapping route rosters) are only visible
    // once every row has been resolved and the import mode is known. Modules
    // that implement `batchIssues` can downgrade offending rows here, before
    // the preview is shown or anything is written.
    const batchIssues =
      typeof prepared?.batchIssues === 'function'
        ? await prepared.batchIssues(resolvedCandidates, mode)
        : null;
    if (batchIssues && batchIssues.size > 0) {
      for (const row of rows) {
        if (row.status !== ImportRowStatus.VALID && row.status !== ImportRowStatus.WILL_UPDATE) {
          continue;
        }
        const key = keyByRowNumber.get(row.rowNumber);
        const issues = key === undefined ? undefined : batchIssues.get(key);
        if (issues && issues.length > 0) {
          row.status = ImportRowStatus.INVALID;
          row.issues = issues;
        }
      }
    }

    return {
      definition,
      prepared,
      rows,
      summary: this.summarize(rows),
      unknownColumns,
      missingColumns,
    };
  }

  /** Counters shown on the result screen; every row is in exactly one bucket. */
  private summarize(rows: AnalyzedRow[]): ImportSummary {
    const count = (status: ImportRowStatus) => rows.filter((row) => row.status === status).length;

    const invalid = count(ImportRowStatus.INVALID);
    const duplicateInFile = count(ImportRowStatus.DUPLICATE_IN_FILE);
    const exists = count(ImportRowStatus.EXISTS);
    const toCreate = count(ImportRowStatus.VALID) + count(ImportRowStatus.CREATED);
    const toUpdate = count(ImportRowStatus.WILL_UPDATE) + count(ImportRowStatus.UPDATED);

    return {
      total_rows: rows.length,
      valid_rows: toCreate + toUpdate,
      invalid_rows: invalid,
      duplicate_rows_in_file: duplicateInFile,
      existing_records: exists + toUpdate,
      rows_to_create: toCreate,
      rows_to_update: toUpdate,
      rows_to_skip: invalid + duplicateInFile + exists,
    };
  }

  /**
   * Flattens Zod issues into column-scoped messages.
   *
   * The schema keys are field names; the admin sees spreadsheet headers, so the
   * path is translated back into the header they actually typed under.
   */
  private zodIssues(
    error: { issues: Array<{ path: (string | number)[]; message: string }> },
    definition: ImportDefinition,
  ): ImportRowIssue[] {
    const headerByField = new Map(
      definition.columns.map((column) => [column.field, column.header]),
    );

    return error.issues.map((issue) => {
      const field = issue.path.length > 0 ? String(issue.path[0]) : null;
      return {
        column: field ? (headerByField.get(field) ?? field) : null,
        message: issue.message,
      };
    });
  }

  /** Best-effort label for a row too broken to parse. */
  private fallbackLabel(values: Record<string, string>): string {
    const firstFilled = Object.values(values).find((value) => value.length > 0);
    return firstFilled ? firstFilled.slice(0, 60) : 'Row could not be read';
  }

  // ---------------------------------------------------------------------------
  // Persistence of the run itself
  // ---------------------------------------------------------------------------

  /** Rows that need to appear in the error workbook. */
  private errorRows(rows: AnalyzedRow[]): ImportRowError[] {
    return rows
      .filter((row) => row.issues.length > 0)
      .slice(0, IMPORT_STORED_ERROR_LIMIT)
      .map((row) => ({
        row_number: row.rowNumber,
        status: row.status,
        issues: row.issues,
        values: row.values,
      }));
  }

  /**
   * Appends the run to `import_jobs`.
   *
   * Best-effort, exactly like audit logging: a history write that fails must
   * not undo an import that succeeded. The caller keeps working with a null id
   * in that (very unlikely) case.
   */
  private async recordJob(
    actor: ImportActor,
    module: ImportModule,
    mode: ImportMode,
    file: UploadedImportFile,
    analysis: AnalysisResult,
    outcome: {
      status: ImportJobStatus;
      dryRun: boolean;
      created: number;
      updated: number;
      failureReason: string | null;
    },
  ): Promise<ImportJob | null> {
    try {
      return await this.importJobs.create({
        school_id: actor.schoolId,
        imported_by: actor.userId,
        module,
        mode,
        file_name: file.originalName.slice(0, 255),
        status: outcome.status,
        dry_run: outcome.dryRun,
        total_rows: analysis.summary.total_rows,
        valid_rows: analysis.summary.valid_rows,
        invalid_rows: analysis.summary.invalid_rows,
        created_count: outcome.created,
        updated_count: outcome.updated,
        skipped_count: analysis.summary.rows_to_skip,
        summary: analysis.summary,
        errors: this.errorRows(analysis.rows),
        unknown_columns: analysis.unknownColumns,
        missing_columns: analysis.missingColumns,
        failure_reason: outcome.failureReason?.slice(0, 500) ?? null,
        completed_at: new Date(),
      } as never);
    } catch (error) {
      this.logger.error(
        `Import history write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async auditCommit(
    actor: ImportActor,
    module: ImportModule,
    mode: ImportMode,
    file: UploadedImportFile,
    analysis: AnalysisResult,
    jobId: string | null,
    success: boolean,
    counts: { created: number; updated: number } = { created: 0, updated: 0 },
  ): Promise<void> {
    // Only counters and the file name are recorded — never a cell value, so
    // names, phone numbers and medical notes stay out of the audit trail.
    await this.audit.log({
      school_id: actor.schoolId,
      actor_user_id: actor.userId,
      action: AUDIT_ACTIONS.IMPORT_COMMIT,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: jobId,
      metadata: {
        module,
        module_label: IMPORT_MODULE_LABELS[module],
        mode,
        file_name: file.originalName,
        success,
        created_count: counts.created,
        updated_count: counts.updated,
        ...analysis.summary,
        ...assistedMetadata(actor),
      },
    });
  }

  /** Turns a write failure into a message an admin can act on. */
  private describeFailure(error: unknown): string {
    if (error instanceof UniqueConstraintError) {
      const fields = Object.keys(error.fields ?? {}).join(', ');
      return fields
        ? `A record with the same ${fields} already exists. No rows were imported.`
        : 'A duplicate record was detected while writing. No rows were imported.';
    }
    if (error instanceof SequelizeValidationError) {
      return `${error.errors.map((item) => item.message).join('; ')}. No rows were imported.`;
    }
    if (error instanceof ConflictException) {
      const response = error.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? String((response as { message: unknown }).message)
          : error.message;
      return message;
    }
    if (error instanceof Error) {
      return `${error.message}. No rows were imported.`;
    }
    return 'The import could not be completed. No rows were imported.';
  }

  private toValidationResponse(
    jobId: string,
    module: ImportModule,
    mode: ImportMode,
    file: UploadedImportFile,
    analysis: AnalysisResult,
  ): ImportValidationResponse {
    // Problem rows lead the preview: the admin needs to see what is wrong
    // before scrolling past 50 rows that are fine.
    const problems = analysis.rows.filter((row) => row.issues.length > 0);
    const clean = analysis.rows.filter((row) => row.issues.length === 0);
    const preview: ImportPreviewRow[] = [...problems, ...clean]
      .slice(0, IMPORT_PREVIEW_LIMIT)
      .map((row) => ({
        row_number: row.rowNumber,
        status: row.status,
        label: row.label,
        issues: row.issues,
      }));

    return {
      job_id: jobId,
      module,
      mode,
      file_name: file.originalName,
      summary: analysis.summary,
      preview,
      preview_truncated: analysis.rows.length > preview.length,
      unknown_columns: analysis.unknownColumns,
      missing_columns: analysis.missingColumns,
      can_import: analysis.summary.rows_to_create + analysis.summary.rows_to_update > 0,
      has_error_file: problems.length > 0,
    };
  }
}
