import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TripAttendanceStatus, TripStudentManifestQuery } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/trips/:tripId/students`.
 *
 * Both filters narrow a manifest that has already been derived and
 * authorised server-side, so neither can widen what the caller may see:
 * `stop_id` is matched against the stops of the trip's own route and an
 * unknown or foreign stop simply yields an empty manifest.
 */
export class ListTripStudentsQueryDto implements TripStudentManifestQuery {
  @IsOptional()
  @IsEnum(TripAttendanceStatus, {
    message: `status must be one of ${Object.values(TripAttendanceStatus).join(', ')}`,
  })
  status?: TripAttendanceStatus;

  @IsOptional()
  @IsUUID(undefined, { message: 'stop_id must be a valid UUID' })
  stop_id?: string;
}
