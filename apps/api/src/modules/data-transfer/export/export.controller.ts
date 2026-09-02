import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  DataFileFormat,
  EXPORT_DATASET_LABELS,
  EXPORT_DATASET_VALUES,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RateLimit } from '../../../common/rate-limit';
import { sanitizeFileName } from '../excel/excel.util';
import { ExportDatasetParamDto, ExportQueryDto } from '../dto/export.dto';
import { ExportService } from './export.service';

/**
 * Data export endpoints.
 *
 * `SCHOOL_ADMIN` only, tenant taken from the verified JWT. The response is
 * streamed with `@Res()` (no passthrough) so the file bypasses the JSON
 * success envelope the global `TransformInterceptor` applies to every other
 * route — a browser downloading a spreadsheet must receive the spreadsheet,
 * not `{ success: true, data: … }`.
 */
@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  /**
   * `GET /api/v1/exports`
   *
   * The catalogue of datasets, so the web app can build its export menu
   * without hard-coding the list.
   */
  @Get()
  listDatasets() {
    return {
      items: EXPORT_DATASET_VALUES.map((dataset) => ({
        dataset,
        label: EXPORT_DATASET_LABELS[dataset],
      })),
    };
  }

  /**
   * `GET /api/v1/exports/:dataset`
   *
   * Streams the dataset as `.xlsx` (default) or `.csv`, honouring the same
   * filters the corresponding list screen uses.
   *
   * Headers are written before the first row is fetched; from that point the
   * rows flow straight from the database to the socket 500 at a time, so the
   * memory cost of a 10 000-row export is the same as a 100-row one.
   */
  @Get(':dataset')
  @RateLimit('data_export')
  async download(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') userId: string,
    @Param() params: ExportDatasetParamDto,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const plan = await this.exports.prepare(schoolId, userId, params.dataset, query);

    const format = query.format ?? DataFileFormat.XLSX;
    const safeName = sanitizeFileName(plan.fileName, `export.${format}`);
    const ascii = safeName.replace(/[^\x20-\x7e]/g, '_');

    response.setHeader('Content-Type', plan.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    // The row count is useful to the client (and to a proxy log) but the body
    // length is unknown up front, so it travels as a header of its own.
    response.setHeader('X-Total-Records', String(plan.total));

    await plan.stream(response);
  }
}
