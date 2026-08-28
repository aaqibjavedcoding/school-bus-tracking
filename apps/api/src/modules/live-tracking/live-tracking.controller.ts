import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';
import { LiveTrackingService } from './live-tracking.service';
import { ListTripLocationHistoryQueryDto } from './dto/list-trip-location-history-query.dto';

/** Reusable 400-on-failure UUID pipe for the trip path parameter. */
const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Read-only REST surface of live GPS tracking.
 *
 * Live updates themselves travel over the `/live-tracking` Socket.IO
 * namespace (see `LiveTrackingGateway`); these endpoints exist for clients
 * that need a snapshot: the latest known position and a bounded history
 * window.
 *
 * Authorization mirrors the trip attendance rules: the tenant comes from the
 * verified JWT, and the caller must be the trip's school admin, its rostered
 * driver/conductor or — for reads — the parent of a student on the trip.
 * Nothing about ownership is taken from the request.
 */
@Controller('trips/:tripId/location')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT)
export class LiveTrackingController {
  constructor(private readonly liveTrackingService: LiveTrackingService) {}

  /** `GET /api/v1/trips/:tripId/location` — latest known position. */
  @Get()
  async getLatest(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
  ) {
    return this.liveTrackingService.getLatestLocation(actor, tripId);
  }

  /**
   * `GET /api/v1/trips/:tripId/location/history`
   *
   * Chronological fix history, bounded by an optional `from`/`to` window on
   * `recorded_at` and always by `limit` (default 100, max 500).
   */
  @Get('history')
  async getHistory(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
    @Query() query: ListTripLocationHistoryQueryDto,
  ) {
    return this.liveTrackingService.getLocationHistory(actor, tripId, query);
  }
}
