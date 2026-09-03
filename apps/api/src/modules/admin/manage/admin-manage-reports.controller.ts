import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DataFileFormat, UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RateLimit } from '../../../common/rate-limit';
import { sanitizeFileName } from '../../../modules/data-transfer/excel/excel.util';
import { ReportQueryDto } from '../../../modules/reports/dto/report-query.dto';
import { AdminManageReportParamDto } from './admin-manage.dto';
import { ReportsService } from '../../../modules/reports/reports.service';
import { AssistedSessionService } from './assisted-session.service';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

/**
 * Read-only assisted reporting over the managed school's data.
 *
 * Same catalogue, same paginated definitions and same spreadsheet exporter as
 * the school admin's console — {@link ReportsService} is read-only by design
 * (it exposes no write path at all), which is the simplest guarantee that a
 * report can never mutate the data it describes.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/reports`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly sessions: AssistedSessionService,
  ) {}

  /** Catalogue of available reports and the filters each one supports. */
  @Get()
  catalogue() {
    return this.reports.catalogue();
  }

  /** Headline figures for the reports landing page. */
  @Get('overview')
  @RateLimit('report_read')
  overview(@Param(MANAGED_SCHOOL_PARAM) schoolId: string) {
    return this.reports.overview(schoolId);
  }

  /** Downloads a report with the same filters as the on-screen table. */
  @Get(':report/export')
  @RateLimit('report_read')
  async exportReport(
    @Param(MANAGED_SCHOOL_PARAM) schoolId: string,
    @Req() request: Request & { user?: { id?: string } },
    @Param() params: AdminManageReportParamDto,
    @Query() query: ReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const userId = request.user?.id;
    if (!userId) {
      // Unreachable behind JwtAuthGuard.
      throw new Error('Authenticated actor is required');
    }

    const sessionId = await this.sessions.findOpenSessionId(schoolId, userId);
    const file = await this.reports.exportReport(schoolId, userId, params.report, query, {
      assisted_session_id: sessionId,
    });

    const format = query.format ?? DataFileFormat.XLSX;
    const safeName = sanitizeFileName(file.fileName, `report.${format}`);
    const ascii = safeName.replace(/[^\x20-\x7e]/g, '_');

    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );
    response.setHeader('Content-Length', String(file.buffer.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.end(file.buffer);
  }

  /** Runs one report: summary cards plus a paginated result table. */
  @Get(':report')
  @RateLimit('report_read')
  run(
    @Param(MANAGED_SCHOOL_PARAM) schoolId: string,
    @Param() params: AdminManageReportParamDto,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.run(schoolId, params.report, query);
  }
}
