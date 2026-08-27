import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { TripCreateRequest } from '@school-bus-tracking/shared-types';

/**
 * Body of `POST /api/v1/trips`.
 *
 * The payload is intentionally minimal: a trip is dispatched from an existing
 * active `RouteAssignment`, and the service derives `school_id`, `route_id`,
 * `bus_id`, `driver_id` and `conductor_id` from that roster row. Crew,
 * vehicle, tenant and lifecycle fields are therefore never accepted from a
 * client, so a request can neither cross tenants nor forge a trip state.
 */
export class CreateTripDto implements TripCreateRequest {
  @IsUUID(undefined, { message: 'route_assignment_id must be a valid UUID' })
  route_assignment_id!: string;

  @IsISO8601({ strict: true }, { message: 'scheduled_start_at must be a valid ISO-8601 date-time' })
  scheduled_start_at!: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'scheduled_end_at must be a valid ISO-8601 date-time' })
  declare scheduled_end_at?: string | null;
}
