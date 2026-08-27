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
import { BusesService } from './buses.service';
import { CreateBusDto } from './dto/create-bus.dto';
import { ListBusesQueryDto } from './dto/list-buses-query.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

/**
 * Tenant-safe fleet management endpoints.
 *
 * Every handler derives `school_id` exclusively from the authenticated user's
 * verified JWT claims (`@CurrentUser('school_id')`) — client-supplied values
 * are neither read nor trusted. Only `SCHOOL_ADMIN` may manage buses; every
 * other authenticated role is rejected with 403 by the RolesGuard.
 */
@Controller('buses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class BusesController {
  constructor(private readonly busesService: BusesService) {}

  /**
   * `POST /api/v1/buses`
   *
   * Creates a bus scoped to the authenticated admin's school.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('school_id') schoolId: string, @Body() dto: CreateBusDto) {
    return this.busesService.create(schoolId, dto);
  }

  /**
   * `GET /api/v1/buses`
   *
   * Paginated, searchable list of the authenticated school's buses only.
   */
  @Get()
  async findAll(@CurrentUser('school_id') schoolId: string, @Query() query: ListBusesQueryDto) {
    return this.busesService.findAll(schoolId, query);
  }

  /**
   * `GET /api/v1/buses/:id`
   *
   * Returns the bus only when both id and school match.
   */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.busesService.findOne(schoolId, id);
  }

  /**
   * `PATCH /api/v1/buses/:id`
   *
   * Partial update; ownership cannot be changed through the API.
   */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateBusDto,
  ) {
    return this.busesService.update(schoolId, id, dto);
  }

  /**
   * `DELETE /api/v1/buses/:id`
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
    return this.busesService.remove(schoolId, id);
  }
}
