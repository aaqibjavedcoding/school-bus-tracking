import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { DataFileFormat, UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RateLimit } from '../../common/rate-limit';
import { sanitizeFileName } from '../data-transfer/excel/excel.util';
import { ReportParamDto, ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/**
 * School-admin reporting endpoints.
 *
 * `SCHOOL_ADMIN` only, tenant from the verified JWT. Reports are read-only
 * aggregations over the tenant's own rows — there is no path here that can
 * observe or modify another school's data.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * `GET /api/v1/reports`
   *
   * Catalogue of available reports with the filters each one supports, so the
   * UI renders only the inputs that will actually be honoured.
   */
  @Get()
  catalogue() {
    return this.reports.catalogue();
  }

  /**
   * `GET /api/v1/reports/overview`
   *
   * Headline figures for the reports landing page: students, transport,
   * operations and compliance, all from live counts.
   */
  @Get('overview')
  @RateLimit('report_read')
  async overview(@CurrentUser('school_id') schoolId: string) {
    return this.reports.overview(schoolId);
  }

  /**
   * `GET /api/v1/reports/:report/export`
   *
   * Downloads the report with the *same* filters as the on-screen table, so the
   * file can never disagree with what the admin was looking at.
   *
   * Declared before `:report` so `export` is not swallowed by the parameterised
   * route.
   */
  @Get(':report/export')
  @RateLimit('report_read')
  async exportReport(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') userId: string,
    @Param() params: ReportParamDto,
    @Query() query: ReportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.reports.exportReport(schoolId, userId, params.report, query);

    const format = query.format ?? DataFileFormat.XLSX;
    const safeName = sanitizeFileName(file.fileName, `report.${format}`);
    const ascii = safeName.replace(/[^\x20-\x7e]/g, '_');

    // `@Res()` without passthrough: the download must not be wrapped in the
    // JSON success envelope.
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

  /**
   * `GET /api/v1/reports/:report`
   *
   * Runs one report and returns summary cards plus a paginated result table.
   */
  @Get(':report')
  @RateLimit('report_read')
  async run(
    @CurrentUser('school_id') schoolId: string,
    @Param() params: ReportParamDto,
    @Query() query: ReportQueryDto,
  ) {
    return this.reports.run(schoolId, params.report, query);
  }
}
