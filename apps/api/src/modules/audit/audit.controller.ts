import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AuditService, type AuditLogListResponse, type ListAuditLogsQuery } from './audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { TenantRequestUser } from '../../common/guards';

/**
 * Read-only audit-log endpoint for admin UIs.
 *
 * - **Super Admin** sees platform-wide audit events (may filter by school).
 * - **School Admin** sees only their own school's events.
 *
 * No write endpoint exists — audit logs are append-only from the
 * application's perspective.
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.SCHOOL_ADMIN)
  async list(
    @CurrentUser() user: TenantRequestUser,
    @Query() query: ListAuditLogsQuery,
  ): Promise<AuditLogListResponse> {
    // School Admin is always scoped to their own school.
    const schoolId =
      user.role === UserRole.SCHOOL_ADMIN ? user.school_id : query.school_id;

    return this.auditService.list(query, { schoolId });
  }
}
