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
  AdminSchoolCreateRequest,
  AdminSchoolDetailsResponse,
  AdminSchoolLifecycleResponse,
  AdminSchoolListResponse,
  AdminSchoolResponse,
  AdminSchoolUpdateRequest,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { AdminSchoolsService } from './admin-schools.service';
import { CreateAdminSchoolDto, ListAdminSchoolsQueryDto, UpdateAdminSchoolDto } from './dto';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Platform school management for Super Admins (`/api/v1/admin/schools`).
 *
 * Every route requires an authenticated `SUPER_ADMIN` — the guards and the
 * method-level `@Roles` metadata are repeated on each handler so authorization
 * is unambiguous and individually testable. School users get 403 and
 * anonymous callers get 401. The managed school id always comes from the
 * route (the platform operator is explicitly acting on another tenant) and
 * is re-validated server-side on every call.
 */
@Controller('admin/schools')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminSchoolsController {
  constructor(private readonly adminSchools: AdminSchoolsService) {}

  /** `POST /admin/schools` — provision a tenant school with its first admin. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN)
  async create(@Body() dto: CreateAdminSchoolDto): Promise<AdminSchoolDetailsResponse> {
    return this.adminSchools.create(dto as AdminSchoolCreateRequest);
  }

  /** `GET /admin/schools` — paginated, searchable, status-filtered list. */
  @Get()
  @RateLimit('read_heavy')
  @Roles(UserRole.SUPER_ADMIN)
  async findAll(@Query() query: ListAdminSchoolsQueryDto): Promise<AdminSchoolListResponse> {
    return this.adminSchools.findAll(query);
  }

  /** `GET /admin/schools/:id` — full platform overview of one tenant. */
  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN)
  async findOne(@Param('id', uuidParam()) id: string): Promise<AdminSchoolDetailsResponse> {
    return this.adminSchools.findOneOrThrow(id);
  }

  /** `PATCH /admin/schools/:id` — school profile update; identity fields fixed. */
  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  async update(
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateAdminSchoolDto,
  ): Promise<AdminSchoolResponse> {
    return this.adminSchools.update(id, dto as AdminSchoolUpdateRequest);
  }

  /** `POST /admin/schools/:id/activate` — restore tenant access. */
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  async activate(@Param('id', uuidParam()) id: string): Promise<AdminSchoolLifecycleResponse> {
    return this.adminSchools.activate(id);
  }

  /** `POST /admin/schools/:id/deactivate` — suspend access; data is preserved. */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  async deactivate(@Param('id', uuidParam()) id: string): Promise<AdminSchoolLifecycleResponse> {
    return this.adminSchools.deactivate(id);
  }
}
