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
import { ParentGuardiansService } from '../../../modules/parents/parent-guardians.service';
import { ParentsService } from '../../../modules/parents/parents.service';
import { CreateParentDto } from '../../../modules/parents/dto/create-parent.dto';
import { CreateParentStudentRelationshipDto } from '../../../modules/parents/dto/create-parent-student-relationship.dto';
import { ListParentsQueryDto } from '../../../modules/parents/dto/list-parents-query.dto';
import { UpdateParentDto } from '../../../modules/parents/dto/update-parent.dto';
import { UpdateParentStudentRelationshipDto } from '../../../modules/parents/dto/update-parent-student-relationship.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Assisted management of a school's parents/guardians and their student
 * relationships.
 *
 * Both the {@link ParentsService} CRUD and the {@link ParentGuardiansService}
 * relationship operations are the exact implementations the school admin uses;
 * every cross-entity reference (student id, parent id) is re-verified by those
 * services against the managed school, so a relationship can never be created
 * between a parent of school A and a student of school B.
 *
 * Parent *portal* capabilities (self-service reads, notifications) are not
 * exposed here — this surface is administrative only.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/parents`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageParentsController {
  constructor(
    private readonly parentsService: ParentsService,
    private readonly parentGuardiansService: ParentGuardiansService,
  ) {}

  /** `POST …/manage/parents` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string, @Body() dto: CreateParentDto) {
    return this.parentsService.create(schoolId, dto);
  }

  /** `GET …/manage/parents` — paginated, searchable. */
  @Get()
  @RateLimit('read_heavy')
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListParentsQueryDto,
  ) {
    return this.parentsService.findAll(schoolId, query);
  }

  /** `GET …/manage/parents/:parentId` */
  @Get(':parentId')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
  ) {
    return this.parentsService.findOne(schoolId, parentId);
  }

  /** `PATCH …/manage/parents/:parentId` */
  @Patch(':parentId')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
    @Body() dto: UpdateParentDto,
  ) {
    return this.parentsService.update(schoolId, parentId, dto);
  }

  /** `DELETE …/manage/parents/:parentId` — paranoid soft delete. */
  @Delete(':parentId')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
  ) {
    return this.parentsService.remove(schoolId, parentId);
  }

  /** `POST …/manage/parents/:parentId/students` — link a guardian to a student. */
  @Post(':parentId/students')
  @HttpCode(HttpStatus.CREATED)
  linkStudent(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
    @Body() dto: CreateParentStudentRelationshipDto,
  ) {
    return this.parentGuardiansService.createForParent(schoolId, parentId, dto);
  }

  /** `GET …/manage/parents/:parentId/students` */
  @Get(':parentId/students')
  listStudents(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
  ) {
    return this.parentGuardiansService.listForParent(schoolId, parentId);
  }

  /** `PATCH …/manage/parents/:parentId/students/:studentId` */
  @Patch(':parentId/students/:studentId')
  updateStudentLink(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
    @Param('studentId', uuidParam()) studentId: string,
    @Body() dto: UpdateParentStudentRelationshipDto,
  ) {
    return this.parentGuardiansService.updateForParent(schoolId, parentId, studentId, dto);
  }

  /** `DELETE …/manage/parents/:parentId/students/:studentId` */
  @Delete(':parentId/students/:studentId')
  @HttpCode(HttpStatus.OK)
  unlinkStudent(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('parentId', uuidParam()) parentId: string,
    @Param('studentId', uuidParam()) studentId: string,
  ) {
    return this.parentGuardiansService.removeForParent(schoolId, parentId, studentId);
  }
}
