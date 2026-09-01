import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminSubscriptionListResponse, UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminGlobalSubscriptionsService } from './admin-global-subscriptions.service';
import { ListAdminSubscriptionsQueryDto } from './dto';

/**
 * Platform-wide subscription console (`/api/v1/admin/subscriptions`).
 *
 * SUPER_ADMIN only. The school and plan relationships always come from the
 * data model — no client-supplied tenant id is accepted anywhere. School
 * users get 403 and anonymous callers get 401, exactly like every other
 * platform console route.
 */
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminGlobalSubscriptionsController {
  constructor(private readonly subscriptions: AdminGlobalSubscriptionsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  async findAll(
    @Query() query: ListAdminSubscriptionsQueryDto,
  ): Promise<AdminSubscriptionListResponse> {
    return this.subscriptions.findAll(query);
  }
}
