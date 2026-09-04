/**
 * Endpoint definitions for the `live-tracking` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import { tenantUser } from '../http/route-runtime';
import type { EndpointDefinition } from '../http/route-runtime';
import { UserRole } from '@school-bus-tracking/shared-types';
import { LiveTrackingService } from '../modules/live-tracking/live-tracking.service';
import { ListTripLocationHistoryQueryDto } from '../modules/live-tracking/dto/list-trip-location-history-query.dto';

/** `GET /api/v1/trips/:tripId/location` */
export const getTripsByTripIdLocation: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  rateLimit: 'location_read',
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    return container().liveTracking().getLatestLocation(actor, tripId);
  },
};

/** `GET /api/v1/trips/:tripId/location/history` */
export const getTripsByTripIdLocationHistory: EndpointDefinition<unknown, ListTripLocationHistoryQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT],
  rateLimit: 'location_read',
  status: HttpStatus.OK,
  queryType: ListTripLocationHistoryQueryDto,
  handler: async ({ user, query, params }) => {
    const actor = tenantUser(user);
    const tripId = parseUuidParam(params['tripId']);
    return container().liveTracking().getLocationHistory(actor, tripId, query);
  },};
