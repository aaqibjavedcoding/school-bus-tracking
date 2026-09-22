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
    message: `Please select a valid status (one of: ${Object.values(TripStatus).join(', ')}).`,
  })
  status!: TripStatus;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    {
      message:
        'Please enter the actual start time as a date and time, for example 2026-04-01T08:30:00Z.',
    },
  )
  declare actual_start_at?: string | null;

  @IsOptional()
  @IsISO8601(
    { strict: true },
    {
      message:
        'Please enter the actual end time as a date and time, for example 2026-04-01T08:30:00Z.',
    },
  )
  declare actual_end_at?: string | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'Please enter a valid cancellation reason.' })
  @MinLength(1, { message: 'Please enter a value for the cancellation reason.' })
  @MaxLength(500, { message: 'Please enter at most 500 characters for the cancellation reason.' })
  declare cancellation_reason?: string | null;
}
