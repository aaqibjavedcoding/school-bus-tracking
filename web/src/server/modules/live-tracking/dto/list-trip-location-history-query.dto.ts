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
  @IsString({ message: 'from must be an ISO-8601 date-time string' })
  from?: string;

  @IsOptional()
  @IsString({ message: 'to must be an ISO-8601 date-time string' })
  to?: string;

  @IsOptional()
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(MAX_HISTORY_LIMIT, { message: `limit must be at most ${MAX_HISTORY_LIMIT}` })
  limit?: number;
}
