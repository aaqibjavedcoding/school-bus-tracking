import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard, TenantRequestUser } from '../../common/guards';
import { NotificationsService } from './notifications.service';
import { ListParentNotificationsQueryDto } from './dto/list-parent-notifications-query.dto';

/** Reusable 400-on-failure UUID pipe for the notification path parameter. */
const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Parent notification endpoints (`/api/v1/parent/notifications`).
 *
 * Reachable only by an authenticated `PARENT`. Every handler takes the tenant
 * and the parent identity exclusively from the verified JWT claims
 * (`@CurrentUser()`) — a client-supplied `parent_id`, `user_id` or `school_id`
 * is neither read nor trusted, so a parent can only ever touch their own
 * notifications. Unknown ids, another parent's ids and another school's ids
 * all collapse into the same generic 404.
 */
@Controller('parent/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PARENT)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** `GET /api/v1/parent/notifications` — own list + unread count. */
  @Get()
  list(@CurrentUser() actor: TenantRequestUser, @Query() query: ListParentNotificationsQueryDto) {
    return this.notificationsService.listForParent(actor, query);
  }

  /** `PATCH /api/v1/parent/notifications/read-all` — mark everything read. */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() actor: TenantRequestUser) {
    return this.notificationsService.markAllRead(actor);
  }

  /** `PATCH /api/v1/parent/notifications/:id/read` — mark one of mine read. */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() actor: TenantRequestUser, @Param('id', uuidParam()) id: string) {
    return this.notificationsService.markRead(actor, id);
  }
}
