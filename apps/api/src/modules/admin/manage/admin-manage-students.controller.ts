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
import { RateLimit } from '../../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { StudentsService } from '../../../modules/students/students.service';
import { CreateStudentDto } from '../../../modules/students/dto/create-student.dto';
import { ListStudentsQueryDto } from '../../../modules/students/dto/list-students-query.dto';
import { UpdateStudentDto } from '../../../modules/students/dto/update-student.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Assisted management of a school's students.
 *
 * `Super Admin → Schools → ABC School → Manage Data → Students`. This is the
 * same {@link StudentsService} the school admin uses — identical validation,
 * plan limits, duplicate detection and pagination — with the tenant supplied
 * from the guarded route parameter instead of a JWT claim. The platform
 * operator stays the authenticated actor; nothing here touches their own
 * (absent) tenant claim.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/students`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageStudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  /** `POST /admin/schools/:schoolId/manage/students` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Body() dto: CreateStudentDto,
  ) {
    return this.studentsService.create(schoolId, dto);
  }

  /** `GET /admin/schools/:schoolId/manage/students` — paginated, searchable. */
  @Get()
  @RateLimit('read_heavy')
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListStudentsQueryDto,
  ) {
    return this.studentsService.findAll(schoolId, query);
  }

  /** `GET /admin/schools/:schoolId/manage/students/:id` */
  @Get(':id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.studentsService.findOne(schoolId, id);
  }

  /** `PATCH /admin/schools/:schoolId/manage/students/:id` */
  @Patch(':id')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentsService.update(schoolId, id, dto);
  }

  /** `DELETE /admin/schools/:schoolId/manage/students/:id` — paranoid soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.studentsService.remove(schoolId, id);
  }
}
