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
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

/**
 * Tenant-safe student management endpoints.
 *
 * Every handler derives `school_id` exclusively from the authenticated user's
 * verified JWT claims (`@CurrentUser('school_id')`) — client-supplied values
 * are neither read nor trusted. Only `SCHOOL_ADMIN` may manage students; every
 * other authenticated role is rejected with 403 by the RolesGuard.
 */
@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  /**
   * `POST /api/v1/students`
   *
   * Creates a student scoped to the authenticated admin's school.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('school_id') schoolId: string, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(schoolId, dto);
  }

  /**
   * `GET /api/v1/students`
   *
   * Paginated, searchable list of the authenticated school's students only.
   */
  @Get()
  async findAll(@CurrentUser('school_id') schoolId: string, @Query() query: ListStudentsQueryDto) {
    return this.studentsService.findAll(schoolId, query);
  }

  /**
   * `GET /api/v1/students/:id`
   *
   * Returns the student only when both id and school match.
   */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.studentsService.findOne(schoolId, id);
  }

  /**
   * `PATCH /api/v1/students/:id`
   *
   * Partial update; ownership cannot be changed through the API.
   */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentsService.update(schoolId, id, dto);
  }

  /**
   * `DELETE /api/v1/students/:id`
   *
   * Soft delete (paranoid model) — the row is never physically removed.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.studentsService.remove(schoolId, id);
  }
}
