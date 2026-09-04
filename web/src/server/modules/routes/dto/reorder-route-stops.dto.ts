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
  @IsArray({ message: 'stop_ids must be an array' })
  @ArrayMaxSize(1000, { message: 'stop_ids must contain at most 1000 ids' })
  @IsUUID(undefined, { each: true, message: 'stop_ids must contain valid UUIDs' })
  stop_ids!: string[];
}
