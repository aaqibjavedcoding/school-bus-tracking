import { IsEnum, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  NOTIFICATION_READ_FILTER_VALUES,
  NotificationReadFilter,
  ParentNotificationListQuery,
} from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/parent/notifications`.
 *
 * Pagination plus the optional `read` / `unread` filter. None of the values
 * can widen what the caller sees: ownership comes from the verified JWT, so
 * every filter only narrows the caller's own notifications.
 */
export class ListParentNotificationsQueryDto implements ParentNotificationListQuery {
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEnum(NotificationReadFilter, {
    message: `status must be one of ${NOTIFICATION_READ_FILTER_VALUES.join(', ')}`,
  })
  status?: NotificationReadFilter;
}
