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
import { StopsService } from './stops.service';
import { CreateStopDto } from './dto/create-stop.dto';
import { ListStopsQueryDto } from './dto/list-stops-query.dto';
import { UpdateStopDto } from './dto/update-stop.dto';

/**
 * Tenant-safe stop management endpoints.
 *
 * Every handler derives `school_id` exclusively from the authenticated user's
 * verified JWT claims (`@CurrentUser('school_id')`) — client-supplied values
 * are neither read nor trusted. Only `SCHOOL_ADMIN` may manage stops; every
 * other authenticated role is rejected with 403 by the RolesGuard.
 */
@Controller('stops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class StopsController {
  constructor(private readonly stopsService: StopsService) {}

  /**
   * `POST /api/v1/stops`
   *
   * Creates a stop (assigned to a route of the authenticated admin's school).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('school_id') schoolId: string, @Body() dto: CreateStopDto) {
    return this.stopsService.create(schoolId, dto);
  }

  /**
   * `GET /api/v1/stops`
   *
   * Paginated, searchable list of the authenticated school's stops only,
   * optionally narrowed to one route.
   */
  @Get()
  async findAll(@CurrentUser('school_id') schoolId: string, @Query() query: ListStopsQueryDto) {
    return this.stopsService.findAll(schoolId, query);
  }

  /**
   * `GET /api/v1/stops/:id`
   *
   * Returns the stop only when both id and school match.
   */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.stopsService.findOne(schoolId, id);
  }

  /**
   * `PATCH /api/v1/stops/:id`
   *
   * Partial update; ownership cannot be changed through the API and the stop
   * can only be moved to another route of the same school.
   */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateStopDto,
  ) {
    return this.stopsService.update(schoolId, id, dto);
  }

  /**
   * `DELETE /api/v1/stops/:id`
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
    return this.stopsService.remove(schoolId, id);
  }
}
