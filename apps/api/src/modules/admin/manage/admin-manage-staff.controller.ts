import {
  Body,
  Controller,
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
  UseInterceptors,
} from '@nestjs/common';
import { StaffRole, UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { RateLimit } from '../../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { StaffService } from '../../../modules/staff/staff.service';
import { CreateStaffDto } from '../../../modules/staff/dto/create-staff.dto';
import { ListStaffQueryDto } from '../../../modules/staff/dto/list-staff-query.dto';
import { UpdateStaffDto } from '../../../modules/staff/dto/update-staff.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Shared assisted-management handlers for driver and conductor accounts.
 *
 * Mirrors the tenant {@link StaffController} shape: the managed resource is a
 * subclass that pins the staff role as a server-owned constant (`DRIVER` for
 * `…/manage/drivers`, `CONDUCTOR` for `…/manage/conductors`). Role and tenant
 * can never be supplied by the client.
 *
 * Credential operations (password resets for school admins, MFA, tokens) are
 * NOT part of this surface — staff records are operational data only.
 */
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export abstract class AdminManageStaffController<R extends StaffRole = StaffRole> {
  protected constructor(
    protected readonly staffService: StaffService,
    protected readonly staffRole: R,
  ) {}

  /** `POST …/manage/drivers` or `…/manage/conductors` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string, @Body() dto: CreateStaffDto) {
    return this.staffService.create(schoolId, this.staffRole, dto);
  }

  /** `GET …/manage/drivers` — paginated, searchable roster. */
  @Get()
  @RateLimit('read_heavy')
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListStaffQueryDto,
  ) {
    return this.staffService.findAll(schoolId, this.staffRole, query);
  }

  /** `GET …/manage/drivers/:id` */
  @Get(':id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.staffService.findOne(schoolId, this.staffRole, id);
  }

  /** `PATCH …/manage/drivers/:id` */
  @Patch(':id')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.update(schoolId, this.staffRole, id, dto);
  }

  /** `DELETE …/manage/drivers/:id` — soft delete; trip history stays intact. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.staffService.remove(schoolId, this.staffRole, id);
  }
}

/** `…/admin/schools/:schoolId/manage/drivers` — assisted driver records. */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/drivers`)
export class AdminManageDriversController extends AdminManageStaffController<
  typeof UserRole.DRIVER
> {
  constructor(staffService: StaffService) {
    super(staffService, UserRole.DRIVER);
  }
}

/** `…/admin/schools/:schoolId/manage/conductors` — assisted conductor records. */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/conductors`)
export class AdminManageConductorsController extends AdminManageStaffController<
  typeof UserRole.CONDUCTOR
> {
  constructor(staffService: StaffService) {
    super(staffService, UserRole.CONDUCTOR);
  }
}
