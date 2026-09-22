import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TripLocationHistoryQuery } from '@school-bus-tracking/shared-types';
import { MAX_HISTORY_LIMIT } from '../live-tracking.constants';

/**
 * Query string of `GET /api/v1/trips/:tripId/location/history`.
 *
 * The DTO does the coarse, pipe-enforced checks (string / integer shape and
 * the hard `limit` bound); the exact ISO-8601 parse and the `from`/`to`
 * ordering are re-validated with the strict Zod schema in the service, so the
 * endpoint is bounded even if a pipe is ever reconfigured.
 */
export class ListTripLocationHistoryQueryDto implements TripLocationHistoryQuery {
  @IsOptional()
  @IsString({
    message: 'Please enter the start time as a date and time, for example 2026-04-01T08:30:00Z.',
  })
  from?: string;

  @IsOptional()
  @IsString({
    message: 'Please enter the end time as a date and time, for example 2026-04-01T08:30:00Z.',
  })
  to?: string;

  @IsOptional()
  @IsInt({ message: 'Please enter a whole number for the page size.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page size.' })
  @Max(MAX_HISTORY_LIMIT, {
    message: `Please enter a value of at most ${MAX_HISTORY_LIMIT} for the page size.`,
  })
  limit?: number;
}
