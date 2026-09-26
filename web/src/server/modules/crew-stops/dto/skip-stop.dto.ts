import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { TripStopSkipRequest } from '@school-bus-tracking/shared-types';
import {
  STOP_SKIP_REASON_MAX_LENGTH,
  STOP_SKIP_REASON_MIN_LENGTH,
} from '@school-bus-tracking/validation';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/trips/:tripId/stops/:stopId/skip`.
 *
 * A skip is the one crew action with nothing physical behind it — no GPS fix,
 * no boarding, no drop — so the reason is **required**, not optional like the
 * trip cancellation note. It is trimmed before it is measured, so three
 * spaces are blank rather than three characters, and the bounds come from the
 * shared validation package so the mobile button can refuse the same input
 * before the request ever leaves the phone.
 *
 * The text is stored verbatim: it is what the school reads later when it asks
 * why a stop was passed.
 */
export class SkipStopDto implements TripStopSkipRequest {
  @Transform(trimmed)
  @IsString({ message: 'Please enter a reason for skipping this stop.' })
  @MinLength(STOP_SKIP_REASON_MIN_LENGTH, {
    message: `Please enter at least ${STOP_SKIP_REASON_MIN_LENGTH} characters for the skip reason.`,
  })
  @MaxLength(STOP_SKIP_REASON_MAX_LENGTH, {
    message: `Please enter at most ${STOP_SKIP_REASON_MAX_LENGTH} characters for the skip reason.`,
  })
  declare reason: string;
}
