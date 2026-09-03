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
import { UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RouteAssignmentsService } from '../../../modules/assignments/assignments.service';
import { CreateRouteAssignmentDto } from '../../../modules/assignments/dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from '../../../modules/assignments/dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from '../../../modules/assignments/dto/update-route-assignment.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Assisted management of a school's bus ↔ route ↔ crew assignments.
 *
 * Reuses {@link RouteAssignmentsService}, which re-validates every referenced
 * bus, route and crew member against the managed school before writing — a
 * cross-school roster row cannot be fabricated through ids taken from
 * another tenant.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/route-assignments`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageAssignmentsController {
  constructor(private readonly assignmentsService: RouteAssignmentsService) {}

  /** `POST …/manage/route-assignments` — roster one driver or conductor. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Body() dto: CreateRouteAssignmentDto,
  ) {
    return this.assignmentsService.create(schoolId, dto);
  }

  /** `GET …/manage/route-assignments` — paginated tenant-scoped roster. */
  @Get()
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListRouteAssignmentsQueryDto,
  ) {
    return this.assignmentsService.findAll(schoolId, query);
  }

  /** `GET …/manage/route-assignments/:id` */
  @Get(':id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.assignmentsService.findOne(schoolId, id);
  }

  /** `PATCH …/manage/route-assignments/:id` */
  @Patch(':id')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateRouteAssignmentDto,
  ) {
    return this.assignmentsService.update(schoolId, id, dto);
  }

  /** `DELETE …/manage/route-assignments/:id` — paranoid soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.assignmentsService.remove(schoolId, id);
  }
}
