import { NotFoundException } from '../../../framework';
import { Op, type WhereOptions } from 'sequelize';
import {
  IMPORT_MODULE_LABELS,
  type ImportJobDetailResponse,
  type ImportJobListQuery,
  type ImportJobListResponse,
  type ImportJobResponse,
  type ImportRowError,
  type PaginationMeta,
} from '@school-bus-tracking/shared-types';
import type { ImportJob, User } from '../../../database/models';
import {
  AUDIT_ACTIONS,
  AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
  AUDIT_ENTITY_TYPES,
  type AssistedAuditContext,
  AuditService,
} from '../../audit';
import {
  DATA_TRANSFER_IMPORT_JOBS_REPOSITORY,
  DATA_TRANSFER_USERS_REPOSITORY,
  IMPORT_ERROR_FILE_UNAVAILABLE_MESSAGE,
  IMPORT_JOB_NOT_FOUND_MESSAGE,
} from '../data-transfer.constants';
import { getImportDefinition } from './definitions';
import { buildErrorWorkbook, errorFileName } from './import-error-file.builder';

/** Result of a history error-file download. */
export interface ErrorFileDownload {
  buffer: Buffer;
  fileName: string;
}

/**
 * Read side of the import history.
 *
 * Every query is pinned to the authenticated school, and a job belonging to
 * another tenant produces the same generic 404 as one that never existed — the
 * history endpoints leak nothing about other schools' activity.
 */
export class ImportHistoryService {
  constructor(
    private readonly importJobs: typeof ImportJob,
    private readonly users: typeof User,
    private readonly audit: AuditService,
  ) {}

  /** Paginated history, newest first. */
  async list(schoolId: string, query: ImportJobListQuery): Promise<ImportJobListResponse> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)));

    const where: Record<string, unknown> = { school_id: schoolId };
    if (query.module) {
      where.module = query.module;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.date_from || query.date_to) {
      const range: Record<symbol, Date> = {};
      if (query.date_from) {
        range[Op.gte] = new Date(`${query.date_from}T00:00:00.000Z`);
      }
      if (query.date_to) {
        // Inclusive end date: filters are expressed in whole days.
        range[Op.lt] = new Date(new Date(`${query.date_to}T00:00:00.000Z`).getTime() + 86_400_000);
      }
      where.created_at = range;
    }

    const { rows, count } = await this.importJobs.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [['created_at', 'DESC']],
      // The stored error payload can be large and is never needed by the list.
      attributes: { exclude: ['errors'] },
    });

    const names = await this.resolveActorNames(schoolId, rows);

    const totalPages = Math.max(1, Math.ceil(count / limit));
    const meta: PaginationMeta = {
      total: count,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return {
      items: rows.map((job) => this.toResponse(job, names)),
      meta,
    };
  }

  /** One run with its stored per-row errors. */
  async findOne(schoolId: string, jobId: string): Promise<ImportJobDetailResponse> {
    const job = await this.requireJob(schoolId, jobId);
    const names = await this.resolveActorNames(schoolId, [job]);

    return {
      ...this.toResponse(job, names),
      summary: job.summary,
      errors: (job.errors ?? []) as ImportRowError[],
      unknown_columns: job.unknown_columns ?? [],
      missing_columns: job.missing_columns ?? [],
    };
  }

  /** Rebuilds the error workbook for a past run. */
  async buildErrorFile(
    schoolId: string,
    actorUserId: string,
    jobId: string,
    /**
     * Set only on the Super Admin assisted-management surface: marks the audit
     * row and links it to the open session.
     */
    context?: AssistedAuditContext,
  ): Promise<ErrorFileDownload> {
    const job = await this.requireJob(schoolId, jobId);
    const errors = (job.errors ?? []) as ImportRowError[];

    if (errors.length === 0) {
      throw new NotFoundException(IMPORT_ERROR_FILE_UNAVAILABLE_MESSAGE);
    }

    const definition = getImportDefinition(job.module);
    const buffer = await buildErrorWorkbook(definition, errors);

    await this.audit.log({
      school_id: schoolId,
      actor_user_id: actorUserId,
      action: AUDIT_ACTIONS.IMPORT_ERROR_FILE_DOWNLOAD,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: job.id,
      metadata: {
        module: job.module,
        file_name: job.file_name,
        error_rows: errors.length,
        ...(context
          ? {
              context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
              assisted_session_id: context.assisted_session_id ?? null,
            }
          : {}),
      },
    });

    return { buffer, fileName: errorFileName(job.file_name) };
  }

  /** Tenant-pinned fetch; a foreign id is indistinguishable from a missing one. */
  private async requireJob(schoolId: string, jobId: string): Promise<ImportJob> {
    const job = await this.importJobs.findOne({ where: { id: jobId, school_id: schoolId } });
    if (!job) {
      throw new NotFoundException(IMPORT_JOB_NOT_FOUND_MESSAGE);
    }
    return job;
  }

  /** Batch-resolves "uploaded by" names without an association join. */
  private async resolveActorNames(
    schoolId: string,
    jobs: ImportJob[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(jobs.map((job) => job.imported_by).filter(Boolean))] as string[];
    if (ids.length === 0) {
      return new Map();
    }
    const users = await this.users.findAll({
      where: { id: { [Op.in]: ids }, school_id: schoolId },
      attributes: ['id', 'first_name', 'last_name'],
    });
    return new Map(users.map((user) => [user.id, `${user.first_name} ${user.last_name}`.trim()]));
  }
  private toResponse(job: ImportJob, names: Map<string, string>): ImportJobResponse {
    return {
      id: job.id,
      module: job.module,
      module_label: IMPORT_MODULE_LABELS[job.module] ?? job.module,
      mode: job.mode,
      file_name: job.file_name,
      status: job.status,
      dry_run: job.dry_run,
      total_rows: job.total_rows,
      valid_rows: job.valid_rows,
      invalid_rows: job.invalid_rows,
      created_count: job.created_count,
      updated_count: job.updated_count,
      skipped_count: job.skipped_count,
      imported_by_name: job.imported_by ? (names.get(job.imported_by) ?? null) : null,
      started_at: toIso(job.created_at),
      completed_at: job.completed_at ? toIso(job.completed_at) : null,
      failure_reason: job.failure_reason,
      // `errors` is excluded from list queries, so fall back to the counters.
      has_error_file: Array.isArray(job.errors)
        ? job.errors.length > 0
        : job.invalid_rows + job.skipped_count > 0,
    };
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
