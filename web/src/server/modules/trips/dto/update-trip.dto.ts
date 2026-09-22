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
  /** Re-dispatch onto this run (preferred over the deprecated assignment id). */
  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid run.' })
  run_id?: string;

  /**
   * @deprecated Prefer `run_id`; kept for pre-refactor callers.
   */
  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid route assignment.' })
  route_assignment_id?: string;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    {
      message:
        'Please enter the scheduled start time as a date and time, for example 2026-04-01T08:30:00Z.',
    },
  )
  scheduled_start_at?: string;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    {
      message:
        'Please enter the scheduled end time as a date and time, for example 2026-04-01T08:30:00Z.',
    },
  )
  declare scheduled_end_at?: string | null;
}
