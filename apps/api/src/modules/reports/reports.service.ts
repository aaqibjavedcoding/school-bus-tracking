import { Inject, Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import {
  DataFileFormat,
  DocumentStatus,
  ReportType,
  TripStatus,
  UserRole,
  type ReportCatalogueResponse,
  type ReportOverviewResponse,
  type ReportQuery,
  type ReportResultResponse,
  type ReportSummaryCard,
} from '@school-bus-tracking/shared-types';
import { deriveDocumentStatus } from '@school-bus-tracking/validation';
import {
  AUDIT_ACTIONS,
  AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
  AUDIT_ENTITY_TYPES,
  type AssistedAuditContext,
  AuditService,
} from '../audit';
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
import {
  REPORTS_ASSIGNMENTS_REPOSITORY,
  REPORTS_ATTENDANCE_REPOSITORY,
  REPORTS_BUSES_REPOSITORY,
  REPORTS_BUS_DOCUMENTS_REPOSITORY,
  REPORTS_DRIVER_DOCUMENTS_REPOSITORY,
  REPORTS_GUARDIANS_REPOSITORY,
  REPORTS_NOTIFICATIONS_REPOSITORY,
  REPORTS_ROUTES_REPOSITORY,
  REPORTS_STOPS_REPOSITORY,
  REPORTS_STUDENTS_REPOSITORY,
  REPORTS_TRIPS_REPOSITORY,
  REPORTS_USERS_REPOSITORY,
} from './reports.constants';
import { getReportDefinition, reportCatalogue } from './definitions';
import { card, dateRange, type ReportRepositories } from './report.types';
import {
  buildCsv,
  buildWorkbookBuffer,
  downloadFileName,
  FILE_CONTENT_TYPES,
  type SheetCell,
} from '../data-transfer/excel/excel.util';

/** A generated report file ready to be sent to the browser. */
export interface ReportFile {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

/** Rows a single report export may contain. */
const REPORT_EXPORT_MAX_ROWS = 10_000;

/**
 * School-admin reporting.
 *
 * Every number is computed from live, tenant-scoped queries: there is no cache,
 * no snapshot table and no seeded demo data. A report the admin runs twice in a
 * row can legitimately differ — because the underlying data changed, which is
 * the only reason it ever should.
 */
@Injectable()
export class ReportsService {
  private readonly repositories: ReportRepositories;

  constructor(
    @Inject(REPORTS_STUDENTS_REPOSITORY) students: typeof Student,
    @Inject(REPORTS_GUARDIANS_REPOSITORY) guardians: typeof StudentGuardian,
    @Inject(REPORTS_USERS_REPOSITORY) users: typeof User,
    @Inject(REPORTS_BUSES_REPOSITORY) buses: typeof Bus,
    @Inject(REPORTS_ROUTES_REPOSITORY) routes: typeof Route,
    @Inject(REPORTS_STOPS_REPOSITORY) stops: typeof Stop,
    @Inject(REPORTS_ASSIGNMENTS_REPOSITORY) assignments: typeof RouteAssignment,
    @Inject(REPORTS_TRIPS_REPOSITORY) trips: typeof Trip,
    @Inject(REPORTS_ATTENDANCE_REPOSITORY) attendance: typeof TripStudentAttendance,
    @Inject(REPORTS_NOTIFICATIONS_REPOSITORY) notifications: typeof Notification,
    @Inject(REPORTS_BUS_DOCUMENTS_REPOSITORY) busDocuments: typeof BusDocument,
    @Inject(REPORTS_DRIVER_DOCUMENTS_REPOSITORY) driverDocuments: typeof DriverDocument,
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

  /** Static catalogue of available reports. */
  catalogue(): ReportCatalogueResponse {
    return { items: reportCatalogue() };
  }

  /** Runs one report and returns a paginated result table plus summary cards. */
  async run(
    schoolId: string,
    report: ReportType,
    query: ReportQuery,
  ): Promise<ReportResultResponse> {
    const definition = getReportDefinition(report);
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Math.floor(query.limit ?? 50)));

    const result = await definition.run(this.repositories, schoolId, query, {
      offset: (page - 1) * limit,
      limit,
    });

    const totalPages = Math.max(1, Math.ceil(result.total / limit));

    return {
      report,
      label: definition.label,
      summary: result.summary,
      columns: definition.columns,
      rows: result.rows,
      meta: {
        total: result.total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters_applied: this.appliedFilters(definition.filters, query),
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Exports a report as a spreadsheet.
   *
   * The export runs the *same* definition with the same filters as the on-screen
   * table, so the file an admin downloads and the table they were looking at can
   * never disagree. Only pagination differs: the export takes up to
   * {@link REPORT_EXPORT_MAX_ROWS} rows in one pass, since a report is an
   * aggregate and never the unbounded raw table an export dataset can be.
   */
  async exportReport(
    schoolId: string,
    actorUserId: string,
    report: ReportType,
    query: ReportQuery,
    /**
     * Set only on the Super Admin assisted-management surface: marks the audit
     * row and links it to the open session. The actor stays the Super Admin
     * and the report stays scoped to the managed school.
     */
    context?: AssistedAuditContext,
  ): Promise<ReportFile> {
    const definition = getReportDefinition(report);
    const format = query.format ?? DataFileFormat.XLSX;

    const result = await definition.run(this.repositories, schoolId, query, {
      offset: 0,
      limit: REPORT_EXPORT_MAX_ROWS,
    });

    const columns = definition.columns.map((column) => ({
      header: column.label,
      width: Math.min(40, Math.max(14, column.label.length + 6)),
    }));

    const rows: SheetCell[][] = result.rows.map((row) =>
      definition.columns.map((column) => {
        const value = row[column.key];
        return value === null || value === undefined ? '' : value;
      }),
    );

    await this.audit.log({
      school_id: schoolId,
      actor_user_id: actorUserId,
      action: AUDIT_ACTIONS.REPORT_EXPORT,
      entity_type: AUDIT_ENTITY_TYPES.REPORT,
      entity_id: report,
      metadata: {
        report,
        label: definition.label,
        format,
        record_count: result.total,
        exported_rows: rows.length,
        filters_applied: this.appliedFilters(definition.filters, query),
        ...(context
          ? {
              context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
              assisted_session_id: context.assisted_session_id ?? null,
            }
          : {}),
      },
    });

    const fileName = downloadFileName(definition.fileBase, format);

    if (format === DataFileFormat.CSV) {
      return {
        buffer: buildCsv(columns, rows),
        fileName,
        contentType: FILE_CONTENT_TYPES[DataFileFormat.CSV],
      };
    }

    // The summary cards are carried into the workbook: a report printed without
    // its headline numbers loses most of its meaning.
    const buffer = await buildWorkbookBuffer([
      {
        sheetName: definition.label.slice(0, 31),
        columns,
        rows,
      },
      {
        sheetName: 'Summary',
        columns: [
          { header: 'Measure', width: 32 },
          { header: 'Value', width: 16 },
          { header: 'Note', width: 44 },
        ],
        rows: [
          ...result.summary.map((item) => [item.label, item.value, item.hint ?? '']),
          ['', '', ''],
          ['Generated at', new Date().toISOString().slice(0, 16).replace('T', ' '), ''],
          ['Filters applied', '', this.describeFilters(definition.filters, query)],
        ] as SheetCell[][],
      },
    ]);

    return {
      buffer,
      fileName,
      contentType: FILE_CONTENT_TYPES[DataFileFormat.XLSX],
    };
  }

  /**
   * Headline figures for the reports landing page.
   *
   * Deliberately a small fixed set of counts rather than "run every report":
   * this endpoint loads on every visit, so it must stay cheap.
   */
  async overview(schoolId: string): Promise<ReportOverviewResponse> {
    const school = { school_id: schoolId };
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [
      activeStudents,
      allocatedStudents,
      activeBuses,
      activeRoutes,
      activeStops,
      drivers,
      conductors,
      parents,
      tripsLast30,
      completedLast30,
      cancelledLast30,
      attendanceLast30,
      notificationsLast30,
      unreadNotifications,
    ] = await Promise.all([
      this.repositories.students.count({ where: { ...school, is_active: true } }),
      this.repositories.students.count({
        where: { ...school, is_active: true, home_stop_id: { [Op.ne]: null } } as WhereOptions,
      }),
      this.repositories.buses.count({ where: { ...school, is_active: true } }),
      this.repositories.routes.count({ where: { ...school, is_active: true } }),
      this.repositories.stops.count({ where: { ...school, is_active: true } }),
      this.repositories.users.count({
        where: { ...school, role: UserRole.DRIVER, is_active: true },
      }),
      this.repositories.users.count({
        where: { ...school, role: UserRole.CONDUCTOR, is_active: true },
      }),
      this.repositories.users.count({
        where: { ...school, role: UserRole.PARENT, is_active: true },
      }),
      this.repositories.trips.count({
        where: { ...school, scheduled_start_at: { [Op.gte]: thirtyDaysAgo } } as WhereOptions,
      }),
      this.repositories.trips.count({
        where: {
          ...school,
          status: TripStatus.COMPLETED,
          scheduled_start_at: { [Op.gte]: thirtyDaysAgo },
        } as WhereOptions,
      }),
      this.repositories.trips.count({
        where: {
          ...school,
          status: TripStatus.CANCELLED,
          scheduled_start_at: { [Op.gte]: thirtyDaysAgo },
        } as WhereOptions,
      }),
      this.repositories.attendance.count({
        where: { ...school, created_at: { [Op.gte]: thirtyDaysAgo } } as WhereOptions,
      }),
      this.repositories.notifications.count({
        where: { ...school, created_at: { [Op.gte]: thirtyDaysAgo } } as WhereOptions,
      }),
      this.repositories.notifications.count({ where: { ...school, is_read: false } }),
    ]);

    const compliance = await this.complianceCards(schoolId);

    return {
      students: [
        card('active_students', 'Active students', activeStudents),
        card(
          'allocated',
          'With transport',
          allocatedStudents,
          `${activeStudents - allocatedStudents} without a stop`,
        ),
        card('parents', 'Parent accounts', parents),
      ],
      transport: [
        card('buses', 'Active buses', activeBuses),
        card('routes', 'Active routes', activeRoutes),
        card('stops', 'Active stops', activeStops),
        card('crew', 'Drivers and conductors', drivers + conductors, `${drivers} drivers`),
      ],
      operations: [
        card('trips', 'Trips (30 days)', tripsLast30),
        card('completed', 'Completed', completedLast30),
        card('cancelled', 'Cancelled', cancelledLast30),
        card('attendance', 'Attendance records', attendanceLast30),
        card(
          'notifications',
          'Notifications sent',
          notificationsLast30,
          `${unreadNotifications} unread`,
        ),
      ],
      compliance,
      generated_at: new Date().toISOString(),
    };
  }

  /** Expiry counts across bus and driver documents. */
  private async complianceCards(schoolId: string): Promise<ReportSummaryCard[]> {
    const [busDocuments, driverDocuments] = await Promise.all([
      this.repositories.busDocuments.findAll({
        where: { school_id: schoolId },
        attributes: ['id', 'expiry_date'],
      }),
      this.repositories.driverDocuments.findAll({
        where: { school_id: schoolId },
        attributes: ['id', 'expiry_date'],
      }),
    ]);

    const now = new Date();
    const statuses = [...busDocuments, ...driverDocuments].map((document) =>
      deriveDocumentStatus(document.expiry_date, { now }),
    );

    const count = (status: DocumentStatus) => statuses.filter((item) => item === status).length;

    return [
      card('documents', 'Documents on file', statuses.length),
      card('expired', 'Expired', count(DocumentStatus.EXPIRED)),
      card('expiring', 'Expiring soon', count(DocumentStatus.EXPIRING_SOON)),
      card('valid', 'Valid', count(DocumentStatus.VALID)),
    ];
  }

  /**
   * Echo of the filters the report actually applied.
   *
   * Only keys the report declares support for are echoed, so the UI never shows
   * "filtered by bus" on a report that ignored the bus filter.
   */
  private appliedFilters(
    supported: ReadonlyArray<string>,
    query: ReportQuery,
  ): Record<string, string> {
    const applied: Record<string, string> = {};
    for (const key of supported) {
      const value = (query as Record<string, unknown>)[key];
      if (value === undefined || value === null || value === '') {
        continue;
      }
      applied[key] = String(value);
    }
    return applied;
  }

  /** Human sentence describing the applied filters, for the workbook. */
  private describeFilters(supported: ReadonlyArray<string>, query: ReportQuery): string {
    const applied = this.appliedFilters(supported, query);
    const entries = Object.entries(applied);
    if (entries.length === 0) {
      return 'None — the report covers all records.';
    }
    return entries.map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

/** Re-exported so tests can build the same date bounds the reports use. */
export { dateRange };
