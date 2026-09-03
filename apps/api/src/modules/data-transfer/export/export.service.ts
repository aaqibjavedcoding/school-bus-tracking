import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DataFileFormat,
  EXPORT_DATASET_LABELS,
  ExportDataset,
  type ExportQuery,
} from '@school-bus-tracking/shared-types';
import {
  AUDIT_ACTIONS,
  AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
  AUDIT_ENTITY_TYPES,
  type AssistedAuditContext,
  AuditService,
} from '../../audit';
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
import {
  DATA_TRANSFER_ASSIGNMENTS_REPOSITORY,
  DATA_TRANSFER_ATTENDANCE_REPOSITORY,
  DATA_TRANSFER_BUSES_REPOSITORY,
  DATA_TRANSFER_BUS_DOCUMENTS_REPOSITORY,
  DATA_TRANSFER_DRIVER_DOCUMENTS_REPOSITORY,
  DATA_TRANSFER_GUARDIANS_REPOSITORY,
  DATA_TRANSFER_NOTIFICATIONS_REPOSITORY,
  DATA_TRANSFER_ROUTES_REPOSITORY,
  DATA_TRANSFER_STOPS_REPOSITORY,
  DATA_TRANSFER_STUDENTS_REPOSITORY,
  DATA_TRANSFER_TRIPS_REPOSITORY,
  DATA_TRANSFER_USERS_REPOSITORY,
} from '../data-transfer.constants';
import {
  FILE_CONTENT_TYPES,
  downloadFileName,
  writeCsvToStream,
  writeXlsxToStream,
  type StreamSink,
} from '../excel/excel.util';
import { getExportDefinition } from './definitions';
import type { ExportRepositories } from './export.types';

/** Everything the controller needs to set response headers before streaming. */
export interface ExportStreamPlan {
  fileName: string;
  contentType: string;
  /** Rows matching the filters, known before a byte is written. */
  total: number;
  /** Streams the document into `sink` and resolves with the rows written. */
  stream(sink: StreamSink): Promise<number>;
}

/**
 * Streaming, tenant-scoped exports.
 *
 * ## Streaming, not buffering
 *
 * The service never materialises the whole dataset. It hands the controller a
 * plan whose `stream()` pulls 500 rows at a time straight into the HTTP
 * response, so a 10 000-student export costs roughly the same memory as a
 * 100-student one and the browser starts receiving bytes immediately.
 *
 * ## Filters
 *
 * The query is the *same* filter set the list screens use, so "Export" always
 * means "export what I am looking at". Filters a dataset does not understand
 * are ignored rather than rejected — the web app can send its whole filter
 * state without knowing which dataset cares about what.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly repositories: ExportRepositories;

  constructor(
    @Inject(DATA_TRANSFER_STUDENTS_REPOSITORY) students: typeof Student,
    @Inject(DATA_TRANSFER_GUARDIANS_REPOSITORY) guardians: typeof StudentGuardian,
    @Inject(DATA_TRANSFER_USERS_REPOSITORY) users: typeof User,
    @Inject(DATA_TRANSFER_BUSES_REPOSITORY) buses: typeof Bus,
    @Inject(DATA_TRANSFER_ROUTES_REPOSITORY) routes: typeof Route,
    @Inject(DATA_TRANSFER_STOPS_REPOSITORY) stops: typeof Stop,
    @Inject(DATA_TRANSFER_ASSIGNMENTS_REPOSITORY) assignments: typeof RouteAssignment,
    @Inject(DATA_TRANSFER_TRIPS_REPOSITORY) trips: typeof Trip,
    @Inject(DATA_TRANSFER_ATTENDANCE_REPOSITORY) attendance: typeof TripStudentAttendance,
    @Inject(DATA_TRANSFER_NOTIFICATIONS_REPOSITORY) notifications: typeof Notification,
    @Inject(DATA_TRANSFER_BUS_DOCUMENTS_REPOSITORY) busDocuments: typeof BusDocument,
    @Inject(DATA_TRANSFER_DRIVER_DOCUMENTS_REPOSITORY) driverDocuments: typeof DriverDocument,
    private readonly audit: AuditService,
  ) {
    this.repositories = {
      students,
      guardians,
      users,
      buses,
      routes,
      stops,
      assignments,
      trips,
      attendance,
      notifications,
      busDocuments,
      driverDocuments,
    };
  }

  /**
   * Prepares an export.
   *
   * The count runs first so the controller can log the row total and set
   * headers before streaming starts — once bytes are on the wire it is too late
   * to turn the response into an error.
   */
  async prepare(
    schoolId: string,
    actorUserId: string,
    dataset: ExportDataset,
    query: ExportQuery,
    /**
     * Set only on the Super Admin assisted-management surface: marks the audit
     * row and links it to the open session. The actor and the tenant are
     * unchanged — the Super Admin exports the managed school's data as
     * themselves.
     */
    context?: AssistedAuditContext,
  ): Promise<ExportStreamPlan> {
    const definition = getExportDefinition(dataset);
    const format = query.format ?? DataFileFormat.XLSX;

    const prepared = await definition.prepare(this.repositories, schoolId, query);

    await this.audit.log({
      school_id: schoolId,
      actor_user_id: actorUserId,
      action: AUDIT_ACTIONS.EXPORT_DOWNLOAD,
      entity_type: AUDIT_ENTITY_TYPES.EXPORT,
      entity_id: dataset,
      metadata: {
        dataset,
        dataset_label: EXPORT_DATASET_LABELS[dataset],
        format,
        record_count: prepared.total,
        ...(context
          ? {
              context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
              assisted_session_id: context.assisted_session_id ?? null,
            }
          : {}),
        // Only the filters this dataset honours, and never a free-text search
        // term (it can contain a pupil's name).
        filters_applied: this.appliedFilters(definition.supportedFilters, query),
      },
    });

    const sheet = {
      sheetName: definition.label.slice(0, 31),
      columns: definition.columns,
    };

    return {
      fileName: downloadFileName(definition.fileBase, format),
      contentType: FILE_CONTENT_TYPES[format],
      total: prepared.total,
      stream: async (sink: StreamSink) => {
        const written =
          format === DataFileFormat.CSV
            ? await writeCsvToStream(sink, sheet, prepared.loadPage)
            : await writeXlsxToStream(sink, sheet, prepared.loadPage);

        this.logger.log(
          `Exported ${written} ${dataset} row(s) as ${format} for school ${schoolId}`,
        );
        return written;
      },
    };
  }

  /**
   * Filters that were both supplied and understood.
   *
   * `search` is reduced to a boolean: knowing that a search was applied is
   * useful for an audit trail, knowing *what* was searched for is not, and the
   * term is very often a person's name.
   */
  private appliedFilters(
    supported: Array<keyof ExportQuery>,
    query: ExportQuery,
  ): Record<string, unknown> {
    const applied: Record<string, unknown> = {};
    for (const key of supported) {
      const value = query[key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      applied[key] = key === 'search' ? true : value;
    }
    return applied;
  }
}
