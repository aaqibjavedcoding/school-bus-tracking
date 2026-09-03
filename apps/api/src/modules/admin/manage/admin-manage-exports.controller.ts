import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DataFileFormat,
  EXPORT_DATASET_LABELS,
  EXPORT_DATASET_VALUES,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RateLimit } from '../../../common/rate-limit';
import { sanitizeFileName } from '../../../modules/data-transfer/excel/excel.util';
import { ExportQueryDto } from '../../../modules/data-transfer/dto/export.dto';
import { AdminManageExportDatasetParamDto } from './admin-manage.dto';
import { ExportService } from '../../../modules/data-transfer/export/export.service';
import { AssistedSessionService } from './assisted-session.service';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

/**
 * Assisted exports of the managed school's data.
 *
 * The same streaming {@link ExportService} the school admin uses: identical
 * dataset definitions, identical filtering, identical row-by-row streaming
 * (memory cost is flat in result size). The dataset can only ever cover the
 * managed school because every definition pins its `where` clause to the
 * tenant argument handed over here — the route-derived school id.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/exports`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageExportsController {
  constructor(
    private readonly exports: ExportService,
    private readonly sessions: AssistedSessionService,
  ) {}

  /** Catalogue of exportable datasets. */
  @Get()
  listDatasets() {
    return {
      items: EXPORT_DATASET_VALUES.map((dataset) => ({
        dataset,
        label: EXPORT_DATASET_LABELS[dataset],
      })),
    };
  }

  /** Streams one dataset (`.xlsx` default, `.csv` optional) for the school. */
  @Get(':dataset')
  @RateLimit('data_export')
  async download(
    @Param(MANAGED_SCHOOL_PARAM) schoolId: string,
    @Req() request: Request & { user?: { id?: string } },
    @Param() params: AdminManageExportDatasetParamDto,
    @Query() query: ExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const userId = request.user?.id;
    if (!userId) {
      // Unreachable behind JwtAuthGuard.
      throw new Error('Authenticated actor is required');
    }

    const sessionId = await this.sessions.findOpenSessionId(schoolId, userId);
    const plan = await this.exports.prepare(schoolId, userId, params.dataset, query, {
      assisted_session_id: sessionId,
    });

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
    response.setHeader('X-Total-Records', String(plan.total));

    await plan.stream(response);
  }
}
