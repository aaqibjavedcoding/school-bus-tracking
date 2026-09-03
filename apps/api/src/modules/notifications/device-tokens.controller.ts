import { Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Body } from '@nestjs/common';
import {
  type DeviceTokenResponse,
  type DeviceTokenUnregisterResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser } from '../../common/guards';
import { RegisterDeviceTokenDto } from './dto';
import { DeviceTokensService } from './device-tokens.service';

/**
 * Push device registration (`/api/v1/notifications/devices`).
 *
 * A dedicated controller (not the PARENT-scoped one) because **every**
 * school role needs OS-level push — parents receive trip alerts, crew
 * receive assignment/SOS events, school admins monitor incidents. Reachable
 * by every tenant role; the platform `SUPER_ADMIN` is excluded because it
 * has no tenant (and no device to register against one).
 *
 * Both handlers take the tenant and the user exclusively from the verified
 * JWT claims (`@CurrentUser()`). A client-supplied `school_id` or `user_id`
 * is neither read nor trusted, so a device token can only ever be registered
 * to the caller's own `(school_id, user_id)` pair.
 */
@Controller('notifications/devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT)
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  /**
   * `POST /api/v1/notifications/devices` — register/refresh the caller's
   * device push token (login, app start and native token refresh).
   */
  @Post()
  @RateLimit('device_register')
  @HttpCode(HttpStatus.CREATED)
  register(
    @CurrentUser() actor: TenantRequestUser,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponse> {
    return this.deviceTokens.register(actor, dto);
  }

  /**
   * `DELETE /api/v1/notifications/devices/:token` — unregister the caller's
   * device token (logout). The token is URL-encoded by the client; the route
   * parameter is decoded by Express before it reaches the service.
   */
  @Delete(':token')
  @RateLimit('device_register')
  @HttpCode(HttpStatus.OK)
  unregister(
    @CurrentUser() actor: TenantRequestUser,
    @Param('token') token: string,
  ): Promise<DeviceTokenUnregisterResponse> {
    return this.deviceTokens.unregister(actor, token);
  }
}
