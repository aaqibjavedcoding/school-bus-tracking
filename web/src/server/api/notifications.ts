/**
 * Endpoint definitions for the `notifications` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import { tenantUser } from '../http/route-runtime';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole, type DeviceTokenResponse, type DeviceTokenUnregisterResponse } from '@school-bus-tracking/shared-types';
import { RegisterDeviceTokenDto } from '../modules/notifications/dto';
import { DeviceTokensService } from '../modules/notifications/device-tokens.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { ListParentNotificationsQueryDto } from '../modules/notifications/dto/list-parent-notifications-query.dto';

/** `POST /api/v1/notifications/devices` */
export const postNotificationsDevices: EndpointDefinition<RegisterDeviceTokenDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  rateLimit: 'device_register',
  status: HttpStatus.CREATED,
  bodyType: RegisterDeviceTokenDto,
  handler: async ({ user, body }) => {
    const actor = tenantUser(user);
    const dto = body;
    return container().deviceTokens().register(actor, dto);
  },};

/** `DELETE /api/v1/notifications/devices/:token` */
export const deleteNotificationsDevicesByToken: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  rateLimit: 'device_register',
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const token = params['token'] as string;
    return container().deviceTokens().unregister(actor, token);
  },
};

/** `GET /api/v1/parent/notifications` */
export const getParentNotifications: EndpointDefinition<unknown, ListParentNotificationsQueryDto> = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  queryType: ListParentNotificationsQueryDto,
  handler: async ({ user, query }) => {
    const actor = tenantUser(user);
    return container().notifications().listForParent(actor, query);
  },};

/** `PATCH /api/v1/parent/notifications/read-all` */
export const patchParentNotificationsReadall: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user }) => {
    const actor = tenantUser(user);
    return container().notifications().markAllRead(actor);
  },
};

/** `PATCH /api/v1/parent/notifications/:id/read` */
export const patchParentNotificationsByIdRead: EndpointDefinition = {
  roles: [UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const id = parseUuidParam(params['id']);
    return container().notifications().markRead(actor, id);
  },
};
