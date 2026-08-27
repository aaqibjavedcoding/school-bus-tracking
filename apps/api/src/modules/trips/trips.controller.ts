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
import { TripsService } from './trips.service';
import { CancelTripDto } from './dto/cancel-trip.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { ListTripsQueryDto } from './dto/list-trips-query.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';

/**
 * Tenant-safe trip endpoints.
 *
 * A trip is one concrete execution of a route, always dispatched from an
 * active `RouteAssignment`. Only school administrators can manage trips, and
 * every handler takes the tenant exclusively from the verified JWT claims —
 * `school_id` is never read from a body, query string or header.
 */
@Controller('trips')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  /** `POST /api/v1/trips` — schedule a trip from an active assignment. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser('school_id') schoolId: string, @Body() dto: CreateTripDto) {
    return this.tripsService.create(schoolId, dto);
  }

  /** `GET /api/v1/trips` — paginated, filterable, tenant-scoped list. */
  @Get()
  async findAll(@CurrentUser('school_id') schoolId: string, @Query() query: ListTripsQueryDto) {
    return this.tripsService.findAll(schoolId, query);
  }

  /** `GET /api/v1/trips/:id` — tenant-scoped lookup. */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.tripsService.findOne(schoolId, id);
  }

  /** `PATCH /api/v1/trips/:id` — reschedule or re-dispatch a scheduled trip. */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.update(schoolId, id, dto);
  }

  /** `PATCH /api/v1/trips/:id/status` — one validated lifecycle transition. */
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateTripStatusDto,
  ) {
    return this.tripsService.updateStatus(schoolId, id, dto);
  }

  /** `POST /api/v1/trips/:id/cancel` — cancel a run that will not happen. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: CancelTripDto,
  ) {
    return this.tripsService.cancel(schoolId, id, dto);
  }

  /** `DELETE /api/v1/trips/:id` — cancel if still open, then soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ) {
    return this.tripsService.remove(schoolId, id);
  }
}
