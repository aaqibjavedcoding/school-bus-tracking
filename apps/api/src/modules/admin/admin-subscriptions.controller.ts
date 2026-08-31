import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AdminSchoolSubscriptionCancelRequest,
  AdminSchoolSubscriptionCreateRequest,
  AdminSchoolSubscriptionResponse,
  AdminSchoolSubscriptionUpdateRequest,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  CancelSchoolSubscriptionDto,
  CreateSchoolSubscriptionDto,
  UpdateSchoolSubscriptionDto,
} from './dto';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * School subscription management for Super Admins
 * (`/api/v1/admin/schools/:schoolId/subscription`).
 *
 * Every route requires an authenticated `SUPER_ADMIN` — the guards and the
 * method-level `@Roles` metadata are repeated on each handler so authorization
 * is unambiguous and individually testable. SCHOOL_ADMIN, DRIVER, CONDUCTOR
 * and PARENT get 403; anonymous callers get 401.
 *
 * The Super Admin is tenant-less, so no tenant claim is read from the token:
 * the managed school id always comes from the route and is re-validated
 * against the database on every call, which keeps "every subscription belongs
 * to a real school" true without applying school-admin tenant scoping.
 *
 * No payment processing happens on any of these routes.
 */
@Controller('admin/schools/:schoolId/subscription')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: AdminSubscriptionsService) {}

  /**
   * `GET /admin/schools/:schoolId/subscription` — current subscription with
   * its plan, price, billing period, trial/period window and cancellation
   * date. Returns a clean `none` state (not an error) when the school has no
   * subscription.
   */
  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  async get(
    @Param('schoolId', uuidParam()) schoolId: string,
  ): Promise<AdminSchoolSubscriptionResponse> {
    return this.subscriptions.getSubscription(schoolId);
  }

  /** `POST /admin/schools/:schoolId/subscription` — assign an active plan. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN)
  async create(
    @Param('schoolId', uuidParam()) schoolId: string,
    @Body() dto: CreateSchoolSubscriptionDto,
  ): Promise<AdminSchoolSubscriptionResponse> {
    return this.subscriptions.createSubscription(
      schoolId,
      dto as AdminSchoolSubscriptionCreateRequest,
    );
  }

  /**
   * `PATCH /admin/schools/:schoolId/subscription` — change plan and/or
   * lifecycle fields. A plan change preserves the previous subscription as
   * history instead of overwriting it.
   */
  @Patch()
  @Roles(UserRole.SUPER_ADMIN)
  async update(
    @Param('schoolId', uuidParam()) schoolId: string,
    @Body() dto: UpdateSchoolSubscriptionDto,
  ): Promise<AdminSchoolSubscriptionResponse> {
    return this.subscriptions.updateSubscription(
      schoolId,
      dto as AdminSchoolSubscriptionUpdateRequest,
    );
  }

  /**
   * `POST /admin/schools/:schoolId/subscription/cancel` — cancel the live
   * subscription. The record is kept with its cancellation timestamp; no
   * payment, refund or invoice is processed.
   */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  async cancel(
    @Param('schoolId', uuidParam()) schoolId: string,
    @Body() dto: CancelSchoolSubscriptionDto,
  ): Promise<AdminSchoolSubscriptionResponse> {
    return this.subscriptions.cancelSubscription(
      schoolId,
      dto as AdminSchoolSubscriptionCancelRequest,
    );
  }
}
