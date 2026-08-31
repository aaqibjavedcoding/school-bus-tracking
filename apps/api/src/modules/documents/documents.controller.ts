import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DocumentOverviewResponse, UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { DocumentComplianceService } from './document-compliance.service';
import { DocumentOverviewQueryDto } from './dto';

/**
 * School-wide document compliance overview (`/api/v1/documents/overview`).
 *
 * The single screen an operator opens in the morning: every bus and every
 * driver with the requirement entries that need attention, plus the aggregate
 * counters. It is read-only — the actual documents are managed from the bus
 * and driver screens — so there is no write surface here at all.
 */
@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class DocumentsController {
  constructor(private readonly compliance: DocumentComplianceService) {}

  /**
   * `GET /api/v1/documents/overview`
   *
   * Filterable by owner kind, by compliance state (`attention` / `compliant`)
   * and by name. Everything is computed from the school's own documents and
   * requirement configuration.
   */
  @Get('overview')
  async overview(
    @CurrentUser('school_id') schoolId: string,
    @Query() query: DocumentOverviewQueryDto,
  ): Promise<DocumentOverviewResponse> {
    return this.compliance.getOverview(schoolId, query);
  }
}
