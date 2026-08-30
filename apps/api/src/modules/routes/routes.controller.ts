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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';

/**
 * Tenant-safe route management endpoints.
 *
 * Every handler derives `school_id` exclusively from the authenticated user's
 * verified JWT claims (`@CurrentUser('school_id')`) — client-supplied values
 * are neither read nor trusted. Only `SCHOOL_ADMIN` may manage routes; every
 * other authenticated role is rejected with 403 by the RolesGuard.
 *
 * The nested `/routes/:id/stops` endpoints expose the ordered stop manifest
 * of a route; the same tenant pinning applies through the route lookup.
 */
@Controller('routes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  /**
   * `POST /api/v1/routes`
   *
   * Creates a route scoped to the authenticated admin's school.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('school_id') schoolId: string, @Body() dto: CreateRouteDto) {
    return this.routesService.create(schoolId, dto);
  }

  /**
   * `GET /api/v1/routes`
   *
   * Paginated, searchable list of the authenticated school's routes only.
   */
  @Get()
  async findAll(@CurrentUser('school_id') schoolId: string, @Query() query: ListRoutesQueryDto) {
    return this.routesService.findAll(schoolId, query);
  }

  /**
   * `GET /api/v1/routes/:id`
   *
   * Returns the route only when both id and school match. Crew and parents
   * may read a route they already know (typically from an assigned trip) so
   * the live map can label it — listing and mutations stay admin-only.
   */
  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT)
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.routesService.findOne(schoolId, id);
  }

  /**
   * `GET /api/v1/routes/:id/details`
   *
   * Full route-detail payload for the admin console: enriched route facts,
   * ordered stops, assigned students and the route's active trip today.
   */
  @Get(':id/details')
  async getDetails(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.routesService.getDetails(schoolId, id);
  }

  /**
   * `PATCH /api/v1/routes/:id`
   *
   * Partial update; ownership cannot be changed through the API.
   */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routesService.update(schoolId, id, dto);
  }

  /**
   * `DELETE /api/v1/routes/:id`
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
    return this.routesService.remove(schoolId, id);
  }

  /**
   * `GET /api/v1/routes/:id/stops`
   *
   * Ordered stop manifest of the route (ascending sequence_number). Open to
   * observers so the live map can draw stop markers without listing every
   * route in the school.
   */
  @Get(':id/stops')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT)
  async findRouteStops(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.routesService.findRouteStops(schoolId, id);
  }

  /**
   * `PUT /api/v1/routes/:id/stops`
   *
   * Renumbers the route's active stops 1..N from the supplied permutation.
   */
  @Put(':id/stops')
  @HttpCode(HttpStatus.OK)
  async reorderRouteStops(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: ReorderRouteStopsDto,
  ) {
    return this.routesService.reorderRouteStops(schoolId, id, dto);
  }
}
