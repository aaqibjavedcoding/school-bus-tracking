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
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';
import { ParentGuardiansService } from './parent-guardians.service';

/**
 * Student-centred aliases for school-admin roster screens.
 *
 * The parent id is a validated resource id in the body/path; the tenant is
 * still taken exclusively from the authenticated JWT claims.
 */
@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class StudentGuardiansController {
  constructor(private readonly parentGuardiansService: ParentGuardiansService) {}

  /** POST /api/v1/students/:studentId/guardians */
  @Post(':studentId/guardians')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('school_id') schoolId: string,
    @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    studentId: string,
    @Body() dto: CreateStudentGuardianDto,
  ) {
    return this.parentGuardiansService.createForStudent(schoolId, studentId, dto);
  }

  /** GET /api/v1/students/:studentId/guardians */
  @Get(':studentId/guardians')
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    studentId: string,
  ) {
    return this.parentGuardiansService.listForStudent(schoolId, studentId);
  }

  /** PATCH /api/v1/students/:studentId/guardians/:parentId */
  @Patch(':studentId/guardians/:parentId')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    studentId: string,
    @Param('parentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    parentId: string,
    @Body() dto: UpdateParentStudentRelationshipDto,
  ) {
    return this.parentGuardiansService.updateForStudent(schoolId, studentId, parentId, dto);
  }

  /** DELETE /api/v1/students/:studentId/guardians/:parentId */
  @Delete(':studentId/guardians/:parentId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    studentId: string,
    @Param('parentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    parentId: string,
  ) {
    return this.parentGuardiansService.removeForStudent(schoolId, studentId, parentId);
  }
}
