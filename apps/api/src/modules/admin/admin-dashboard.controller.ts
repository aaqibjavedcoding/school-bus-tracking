import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminDashboardResponse, UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * SaaS platform dashboard for the Super Admin (`/api/v1/admin/dashboard`).
 *
 * Aggregate platform metrics only — schools, users, transport — computed via
 * grouped counts. Requires `SUPER_ADMIN`; school users are rejected with 403.
 */
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboard: AdminDashboardService) {}

  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  async getDashboard(): Promise<AdminDashboardResponse> {
    return this.adminDashboard.getMetrics();
  }
}
