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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AdminSchoolAdminListResponse,
  AdminSchoolAdminResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminSchoolAdminsService } from './admin-school-admins.service';
import {
  CreateSchoolAdminDto,
  ListSchoolAdminsQueryDto,
  ResetSchoolAdminPasswordDto,
  UpdateSchoolAdminDto,
} from './dto';

/**
 * Management of a tenant's SCHOOL_ADMIN account(s) by the platform Super
 * Admin (`/api/v1/admin/schools/:id/admins`).
 *
 * The target school is always the route's `:id` — no client-supplied
 * tenant id is accepted — and every row is pinned to
 * `(school_id, role = SCHOOL_ADMIN)` server-side, so neither tenant nor role
 * can be escalated from the body.
 */
@Controller('admin/schools/:id/admins')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminSchoolAdminsController {
  constructor(private readonly adminAccounts: AdminSchoolAdminsService) {}

  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  async list(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    schoolId: string,
    @Query() query: ListSchoolAdminsQueryDto,
  ): Promise<AdminSchoolAdminListResponse> {
    return this.adminAccounts.list(schoolId, query);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    schoolId: string,
    @Body() dto: CreateSchoolAdminDto,
  ): Promise<AdminSchoolAdminResponse> {
    return this.adminAccounts.create(schoolId, dto);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':adminId')
  async update(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    schoolId: string,
    @Param('adminId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    adminId: string,
    @Body() dto: UpdateSchoolAdminDto,
  ): Promise<AdminSchoolAdminResponse> {
    return this.adminAccounts.update(schoolId, adminId, dto);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post(':adminId/activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    schoolId: string,
    @Param('adminId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    adminId: string,
  ): Promise<AdminSchoolAdminResponse> {
    return this.adminAccounts.setActive(schoolId, adminId, true);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post(':adminId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    schoolId: string,
    @Param('adminId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    adminId: string,
  ): Promise<AdminSchoolAdminResponse> {
    return this.adminAccounts.setActive(schoolId, adminId, false);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post(':adminId/reset-password')
  @RateLimit('password_reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    schoolId: string,
    @Param('adminId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    adminId: string,
    @Body() dto: ResetSchoolAdminPasswordDto,
  ): Promise<{ id: string; message: string }> {
    return this.adminAccounts.resetPassword(schoolId, adminId, dto);
  }
}
