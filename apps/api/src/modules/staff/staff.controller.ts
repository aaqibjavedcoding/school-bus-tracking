import {
  Body,
  Delete,
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
  StaffDeleteResponse,
  StaffListResponse,
  StaffResponse,
  StaffRole,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

/**
 * Shared route handlers for driver and conductor staff accounts.
 *
 * Concrete controllers ({@link DriversController},
 * {@link ConductorsController}) supply the resource path and — crucially — the
 * fixed staff role this controller operates on. The role is a constructor
 * constant, never a client value, and the only tenant value ever passed to
 * the service is `school_id` extracted from the verified JWT.
 *
 * The guards and the `SCHOOL_ADMIN` role restriction are declared here once;
 * subclasses inherit them (class metadata resolves through the prototype
 * chain), so staff management can never be exposed to another role.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export abstract class StaffController<R extends StaffRole> {
  protected constructor(
    protected readonly staffService: StaffService,
    protected readonly staffRole: R,
  ) {}

  /** POST resource root — create a staff account in the JWT tenant. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('school_id') schoolId: string,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffResponse<R>> {
    return this.staffService.create(schoolId, this.staffRole, dto);
  }

  /** GET resource root — tenant-scoped, role-pinned staff roster. */
  @Get()
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Query() query: ListStaffQueryDto,
  ): Promise<StaffListResponse<StaffResponse<R>>> {
    return this.staffService.findAll(schoolId, this.staffRole, query);
  }

  /** GET resource root/:id — id, tenant and role must all match. */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<StaffResponse<R>> {
    return this.staffService.findOne(schoolId, this.staffRole, id);
  }

  /** PATCH resource root/:id — profile/credential update; role and tenant fixed. */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffResponse<R>> {
    return this.staffService.update(schoolId, this.staffRole, id, dto);
  }

  /** DELETE resource root/:id — soft-deletes the staff account. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<StaffDeleteResponse> {
    return this.staffService.remove(schoolId, this.staffRole, id);
  }
}
