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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { ParentGuardiansService } from '../../../modules/parents/parent-guardians.service';
import { CreateStudentGuardianDto } from '../../../modules/parents/dto/create-student-guardian.dto';
import { UpdateParentStudentRelationshipDto } from '../../../modules/parents/dto/update-parent-student-relationship.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Assisted management of student ↔ guardian relationships, student-centred
 * (the same shape the "student detail" screen drives).
 *
 * Reuses {@link ParentGuardiansService}, which pins every query with the
 * managed school id and re-validates that both the student and the parent
 * belong to it — a foreign relationship id cannot cross the tenant boundary.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/students/:studentId/guardians`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageStudentGuardiansController {
  constructor(private readonly parentGuardiansService: ParentGuardiansService) {}

  /** `POST …/manage/students/:studentId/guardians` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('studentId', uuidParam()) studentId: string,
    @Body() dto: CreateStudentGuardianDto,
  ) {
    return this.parentGuardiansService.createForStudent(schoolId, studentId, dto);
  }

  /** `GET …/manage/students/:studentId/guardians` */
  @Get()
  list(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('studentId', uuidParam()) studentId: string,
  ) {
    return this.parentGuardiansService.listForStudent(schoolId, studentId);
  }

  /** `PATCH …/manage/students/:studentId/guardians/:parentId` */
  @Patch(':parentId')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('studentId', uuidParam()) studentId: string,
    @Param('parentId', uuidParam()) parentId: string,
    @Body() dto: UpdateParentStudentRelationshipDto,
  ) {
    return this.parentGuardiansService.updateForStudent(schoolId, studentId, parentId, dto);
  }

  /** `DELETE …/manage/students/:studentId/guardians/:parentId` */
  @Delete(':parentId')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('studentId', uuidParam()) studentId: string,
    @Param('parentId', uuidParam()) parentId: string,
  ) {
    return this.parentGuardiansService.removeForStudent(schoolId, studentId, parentId);
  }
}
