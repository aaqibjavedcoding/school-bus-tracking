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
import { RouteAssignmentsService } from './assignments.service';
import { CreateRouteAssignmentDto } from './dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from './dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from './dto/update-route-assignment.dto';

/**
 * Tenant-safe bus, route and crew assignment endpoints.
 *
 * RouteAssignment is a crew-roster row: a complete route roster normally has
 * one DRIVER row and one CONDUCTOR row sharing the same bus, route and dates.
 * Only school administrators can manage rows, and every handler obtains the
 * tenant only from the verified JWT claims.
 */
@Controller('route-assignments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class RouteAssignmentsController {
  constructor(private readonly assignmentsService: RouteAssignmentsService) {}

  /** `POST /api/v1/route-assignments` — roster one driver or conductor. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('school_id') schoolId: string, @Body() dto: CreateRouteAssignmentDto) {
    return this.assignmentsService.create(schoolId, dto);
  }

  /** `GET /api/v1/route-assignments` — paginated tenant-scoped roster. */
  @Get()
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Query() query: ListRouteAssignmentsQueryDto,
  ) {
    return this.assignmentsService.findAll(schoolId, query);
  }

  /** `GET /api/v1/route-assignments/:id` — tenant-scoped lookup. */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.assignmentsService.findOne(schoolId, id);
  }

  /** `PATCH /api/v1/route-assignments/:id` — update roster/date/resource fields. */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateRouteAssignmentDto,
  ) {
    return this.assignmentsService.update(schoolId, id, dto);
  }

  /** `DELETE /api/v1/route-assignments/:id` — paranoid soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.assignmentsService.remove(schoolId, id);
  }
}

/**
 * Short `/api/v1/assignments` alias for clients that do not include the
 * `route-` qualifier in the resource name. It inherits the same handlers,
 * guards and SCHOOL_ADMIN metadata as the canonical controller.
 */
@Controller('assignments')
export class AssignmentsController extends RouteAssignmentsController {
  constructor(assignmentsService: RouteAssignmentsService) {
    super(assignmentsService);
  }
}
