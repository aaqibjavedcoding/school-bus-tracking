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
  AdminPlanCreateRequest,
  AdminPlanLifecycleResponse,
  AdminPlanListResponse,
  AdminPlanResponse,
  AdminPlanUpdateRequest,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminPlansService } from './admin-plans.service';
import {
  CreateAdminPlanDto,
  ListAdminPlansQueryDto,
  UpdateAdminPlanDto,
} from './dto';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Platform plan catalog management for Super Admins (`/api/v1/admin/plans`).
 *
 * Every route requires an authenticated `SUPER_ADMIN` — the guards and the
 * method-level `@Roles` metadata are repeated on each handler so authorization
 * is unambiguous and individually testable. School users get 403 and
 * anonymous callers get 401. Plans are tenant-less (platform-level catalog
 * entries), so no tenant id is accepted from the client anywhere in this
 * controller.
 */
@Controller('admin/plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminPlansController {
  constructor(private readonly adminPlans: AdminPlansService) {}

  /** `POST /admin/plans` — create a new plan tier. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN)
  async create(@Body() dto: CreateAdminPlanDto): Promise<AdminPlanResponse> {
    return this.adminPlans.create(dto as AdminPlanCreateRequest);
  }

  /** `GET /admin/plans` — paginated, searchable, status-filtered plan list. */
  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  async findAll(@Query() query: ListAdminPlansQueryDto): Promise<AdminPlanListResponse> {
    return this.adminPlans.findAll(query);
  }

  /** `GET /admin/plans/:id` — full plan definition. */
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN)
  async findOne(@Param('id', uuidParam()) id: string): Promise<AdminPlanResponse> {
    return this.adminPlans.findOneOrThrow(id);
  }

  /** `PATCH /admin/plans/:id` — update plan details/features/limits. */
  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  async update(
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateAdminPlanDto,
  ): Promise<AdminPlanResponse> {
    return this.adminPlans.update(id, dto as AdminPlanUpdateRequest);
  }

  /** `POST /admin/plans/:id/activate` — make the plan available for sale. */
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  async activate(@Param('id', uuidParam()) id: string): Promise<AdminPlanLifecycleResponse> {
    return this.adminPlans.activate(id);
  }

  /** `POST /admin/plans/:id/deactivate` — retire the plan from sale. */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  async deactivate(@Param('id', uuidParam()) id: string): Promise<AdminPlanLifecycleResponse> {
    return this.adminPlans.deactivate(id);
  }
}
