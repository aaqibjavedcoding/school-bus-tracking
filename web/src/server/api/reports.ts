/**
 * Endpoint definitions for the `reports` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { bufferFileResponse } from '../http/file-response';
import { DataFileFormat, UserRole } from '@school-bus-tracking/shared-types';
import { sanitizeFileName } from '../modules/data-transfer/excel/excel.util';
import { ReportParamDto, ReportQueryDto } from '../modules/reports/dto/report-query.dto';
import { ReportsService } from '../modules/reports/reports.service';

/** `GET /api/v1/reports` */
export const getReports: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return container().reports().catalogue();
  },
};

/** `GET /api/v1/reports/overview` */
export const getReportsOverview: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'report_read',
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const schoolId = user.school_id as string;
    return container().reports().overview(schoolId);
  },
};

/** `GET /api/v1/reports/:report` */
export const getReportsByReport: EndpointDefinition<unknown, ReportQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'report_read',
  status: HttpStatus.OK,
  queryType: ReportQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const routeParams = await validateDto(ReportParamDto, params, 'param');
    return container().reports().run(schoolId, routeParams.report, query);
  },};

/**
 * `GET /api/v1/reports/:report/export`
 *
 * Buffered download; returning a `Response` bypasses the JSON envelope, the
 * same way `@Res()` without passthrough did.
 */
export const getReportsByReportExport: EndpointDefinition<unknown, ReportQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'report_read',
  status: HttpStatus.OK,
  queryType: ReportQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const userId = user.id;
    const routeParams = await validateDto(ReportParamDto, params, 'param');
    const typedQuery = query;

    const file = await container()
      .reports()
      .exportReport(schoolId, userId, routeParams.report, typedQuery);

    const format = typedQuery.format ?? DataFileFormat.XLSX;
    const safeName = sanitizeFileName(file.fileName, `report.${format}`);
    return bufferFileResponse(file.buffer, safeName, format);
  },};
