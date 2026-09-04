/**
 * Endpoint definitions for the `eta` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, NotFoundException, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import { tenantUser } from '../http/route-runtime';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { LiveTrackingService } from '../modules/live-tracking/live-tracking.service';
import { EtaService } from '../modules/eta/eta.service';
import { StopArrivalsService } from '../modules/eta/stop-arrivals.service';
import { ETA_TRIP_NOT_FOUND_MESSAGE } from '../modules/eta/eta.constants';
import type { Trip } from '../database/models';
import type { TenantRequestUser } from '../common/guards';

/**
 * Resolves the trip a reader is allowed to observe.
 *
 * Unknown id, another tenant's trip and "not my trip" all collapse to the same
 * generic 404 — probing can never confirm a trip exists.
 */
async function resolveTripForReader(actor: TenantRequestUser, tripId: string): Promise<Trip> {
  const auth = await container().liveTracking().authorizeObservation(actor, tripId);
  if (!auth.ok) {
    throw new NotFoundException(ETA_TRIP_NOT_FOUND_MESSAGE);
  }
  return auth.trip;
}

/** `GET /api/v1/trips/:tripId/eta` */
export const getTripsByTripIdEta: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const trip = await resolveTripForReader(actor, tripId);
    const latest = await container().liveTracking().getLatestLocationResponse(trip.school_id, trip.id);
    return container().eta().computeTripEta({ trip, latest });
  },
};

/** `GET /api/v1/trips/:tripId/arrivals` */
export const getTripsByTripIdArrivals: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const trip = await resolveTripForReader(actor, tripId);
    return container().stopArrivals().listArrivals(trip);
  },
};

/** `GET /api/v1/trips/:tripId/progress` */
export const getTripsByTripIdProgress: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    const trip = await resolveTripForReader(actor, tripId);
    const latest = await container().liveTracking().getLatestLocationResponse(trip.school_id, trip.id);
    return container().stopArrivals().getProgress(trip, latest);
  },
};
