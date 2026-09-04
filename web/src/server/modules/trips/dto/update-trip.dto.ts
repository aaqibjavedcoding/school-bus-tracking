import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { TripUpdateRequest } from '@school-bus-tracking/shared-types';

/**
 * Body of `PATCH /api/v1/trips/:id` — every field is optional.
 *
 * Rescheduling or re-dispatching a trip is only allowed while it is still
 * `SCHEDULED`. Status changes are handled by `PATCH /api/v1/trips/:id/status`
 * so lifecycle rules cannot be bypassed through a plain field update.
 */
export class UpdateTripDto implements TripUpdateRequest {
  @IsOptional()
  @IsUUID(undefined, { message: 'route_assignment_id must be a valid UUID' })
  route_assignment_id?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'scheduled_start_at must be a valid ISO-8601 date-time' })
  scheduled_start_at?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'scheduled_end_at must be a valid ISO-8601 date-time' })
  declare scheduled_end_at?: string | null;
}
