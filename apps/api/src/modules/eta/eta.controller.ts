import {
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard, TenantRequestUser } from '../../common/guards';
import { LiveTrackingService } from '../live-tracking/live-tracking.service';
import { EtaService } from './eta.service';
import { StopArrivalsService } from './stop-arrivals.service';
import { ETA_TRIP_NOT_FOUND_MESSAGE } from './eta.constants';
import type { Trip } from '../../database/models';

/** Reusable 400-on-failure UUID pipe for the trip path parameter. */
const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Task 22 REST surface — approximate ETA, recorded stop arrivals and the
 * crew progress snapshot.
 *
 * Authorization reuses the live-tracking observation rule in full: the
 * tenant comes from the verified JWT, and the caller must be the trip's
 * school admin, its rostered driver/conductor or — for reads — the parent of
 * a student whose home stop sits on the trip's route. Unauthorized, unknown
 * and cross-tenant trips all collapse into the same generic 404, exactly
 * like the location endpoints.
 *
 * The ETA is approximate (Haversine + device/fallback speed); it never
 * claims road-routing accuracy and is never fabricated without a GPS fix.
 */
@Controller('trips/:tripId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT)
export class EtaController {
  constructor(
    private readonly liveTracking: LiveTrackingService,
    private readonly eta: EtaService,
    private readonly arrivals: StopArrivalsService,
  ) {}

  /** `GET /api/v1/trips/:tripId/eta` — approximate ETA of the upcoming stops. */
  @Get('eta')
  async getEta(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
  ) {
    const trip = await this.resolveTripForReader(actor, tripId);
    const latest = await this.liveTracking.getLatestLocationResponse(trip.school_id, trip.id);
    return this.eta.computeTripEta({ trip, latest });
  }

  /** `GET /api/v1/trips/:tripId/arrivals` — every recorded stop arrival. */
  @Get('arrivals')
  async listArrivals(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
  ) {
    const trip = await this.resolveTripForReader(actor, tripId);
    return this.arrivals.listArrivals(trip);
  }

  /**
   * `GET /api/v1/trips/:tripId/progress` — current stop, next stop, all
   * arrivals and the ETA summary (crew tracking screen).
   */
  @Get('progress')
  async getProgress(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
  ) {
    const trip = await this.resolveTripForReader(actor, tripId);
    const latest = await this.liveTracking.getLatestLocationResponse(trip.school_id, trip.id);
    return this.arrivals.getProgress(trip, latest);
  }

  /** REST authorization: the trip inside the caller's tenant plus the observer rule. */
  private async resolveTripForReader(actor: TenantRequestUser, tripId: string): Promise<Trip> {
    const auth = await this.liveTracking.authorizeObservation(actor, tripId);
    if (!auth.ok) {
      // Unknown id, other tenant and "not my trip" are intentionally the
      // same generic 404 — probing can never confirm existence.
      throw new NotFoundException(ETA_TRIP_NOT_FOUND_MESSAGE);
    }
    return auth.trip;
  }
}
