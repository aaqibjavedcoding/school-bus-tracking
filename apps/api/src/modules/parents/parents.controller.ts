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
} from '@nestjs/common';
import { ParentResponse, UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CreateParentDto } from './dto/create-parent.dto';
import { CreateParentStudentRelationshipDto } from './dto/create-parent-student-relationship.dto';
import { ListParentsQueryDto } from './dto/list-parents-query.dto';
import { UpdateParentDto } from './dto/update-parent.dto';
import { UpdateParentStudentRelationshipDto } from './dto/update-parent-student-relationship.dto';
import { ParentGuardiansService } from './parent-guardians.service';
import { ParentsService } from './parents.service';

/**
 * School-admin parent account and relationship endpoints.
 *
 * The only tenant value passed to either service is `school_id` extracted from
 * the verified JWT. A parent may separately read their own links through
 * `/parents/me/students`; that route uses the JWT subject, never a client id.
 */
@Controller('parents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class ParentsController {
  constructor(
    private readonly parentsService: ParentsService,
    private readonly parentGuardiansService: ParentGuardiansService,
  ) {}

  /** POST /api/v1/parents */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('school_id') schoolId: string,
    @Body() dto: CreateParentDto,
  ): Promise<ParentResponse> {
    return this.parentsService.create(schoolId, dto);
  }

  /** GET /api/v1/parents */
  @Get()
  async findAll(@CurrentUser('school_id') schoolId: string, @Query() query: ListParentsQueryDto) {
    return this.parentsService.findAll(schoolId, query);
  }

  /**
   * Parent self-service view. The subject and tenant are both JWT-derived, so
   * a PARENT cannot substitute another account id or school id.
   */
  @Get('me/students')
  @Roles(UserRole.PARENT)
  async findMyStudents(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') parentId: string,
  ) {
    return this.parentGuardiansService.listForCurrentParent(schoolId, parentId);
  }

  /** POST /api/v1/parents/:parentId/students */
  @Post(':parentId/students')
  @HttpCode(HttpStatus.CREATED)
  async linkStudent(
    @CurrentUser('school_id') schoolId: string,
    @Param('parentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    parentId: string,
    @Body() dto: CreateParentStudentRelationshipDto,
  ) {
    return this.parentGuardiansService.createForParent(schoolId, parentId, dto);
  }

  /** GET /api/v1/parents/:parentId/students */
  @Get(':parentId/students')
  async listStudents(
    @CurrentUser('school_id') schoolId: string,
    @Param('parentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    parentId: string,
  ) {
    return this.parentGuardiansService.listForParent(schoolId, parentId);
  }

  /** PATCH /api/v1/parents/:parentId/students/:studentId */
  @Patch(':parentId/students/:studentId')
  async updateStudentLink(
    @CurrentUser('school_id') schoolId: string,
    @Param('parentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    parentId: string,
    @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    studentId: string,
    @Body() dto: UpdateParentStudentRelationshipDto,
  ) {
    return this.parentGuardiansService.updateForParent(schoolId, parentId, studentId, dto);
  }

  /** DELETE /api/v1/parents/:parentId/students/:studentId */
  @Delete(':parentId/students/:studentId')
  @HttpCode(HttpStatus.OK)
  async unlinkStudent(
    @CurrentUser('school_id') schoolId: string,
    @Param('parentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    parentId: string,
    @Param('studentId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    studentId: string,
  ) {
    return this.parentGuardiansService.removeForParent(schoolId, parentId, studentId);
  }

  /** GET /api/v1/parents/:id */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.parentsService.findOne(schoolId, id);
  }

  /** PATCH /api/v1/parents/:id */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
    @Body() dto: UpdateParentDto,
  ) {
    return this.parentsService.update(schoolId, id, dto);
  }

  /** DELETE /api/v1/parents/:id — soft-deletes the parent account. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) id: string,
  ) {
    return this.parentsService.remove(schoolId, id);
  }
}
