import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';
import { RouteStopsOrderRequest } from '@school-bus-tracking/shared-types';

/**
 * Body of `PUT /api/v1/routes/:id/stops`.
 *
 * `stop_ids` must be a permutation of the route's active stop ids; the
 * service renumbers the stops 1..N in the given order inside a transaction.
 * There is no `school_id` field — the tenant comes exclusively from the
 * authenticated user's JWT claims.
 */
export class ReorderRouteStopsDto implements RouteStopsOrderRequest {
  @IsArray({ message: 'Please provide the stop order as a list.' })
  @ArrayMaxSize(1000, { message: 'Please provide at most 1000 stops.' })
  @IsUUID(undefined, { each: true, message: 'Please select valid stops.' })
  stop_ids!: string[];
}
