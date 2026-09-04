import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { TripStatus, TripStatusUpdateRequest } from '@school-bus-tracking/shared-types';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `PATCH /api/v1/trips/:id/status`.
 *
 * One request performs exactly one transition. The optional timestamps let a
 * dispatcher backfill what actually happened; when they are omitted the
 * service stamps the server clock. `cancelled_at` is never accepted — it is
 * always derived when the trip moves to `CANCELLED`.
 */
export class UpdateTripStatusDto implements TripStatusUpdateRequest {
  @IsEnum(TripStatus, {
    message: `status must be one of ${Object.values(TripStatus).join(', ')}`,
  })
  status!: TripStatus;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'actual_start_at must be a valid ISO-8601 date-time' })
  declare actual_start_at?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'actual_end_at must be a valid ISO-8601 date-time' })
  declare actual_end_at?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'cancellation_reason must be a string' })
  @MinLength(1, { message: 'cancellation_reason cannot be empty' })
  @MaxLength(500, { message: 'cancellation_reason must be at most 500 characters' })
  declare cancellation_reason?: string | null;
}
