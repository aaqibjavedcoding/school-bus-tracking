import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { TripCancelRequest } from '@school-bus-tracking/shared-types';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/trips/:id/cancel`.
 *
 * The reason is optional but, when given, is stored verbatim on the trip as
 * the cancellation audit note.
 */
export class CancelTripDto implements TripCancelRequest {
  @IsOptional()
  @Transform(trimmed)
  @IsString({ message: 'cancellation_reason must be a string' })
  @MinLength(1, { message: 'cancellation_reason cannot be empty' })
  @MaxLength(500, { message: 'cancellation_reason must be at most 500 characters' })
  declare cancellation_reason?: string | null;
}
