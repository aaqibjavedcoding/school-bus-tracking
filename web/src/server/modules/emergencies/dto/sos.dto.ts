import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EmergencySosRequest, EmergencyType } from '@school-bus-tracking/shared-types';
import {
  EMERGENCY_MESSAGE_MAX_LENGTH,
  GPS_ACCURACY_MAX_METERS,
} from '@school-bus-tracking/validation';

const nullableTrim = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Body of `POST /api/v1/emergencies/sos` (crew only).
 *
 * Everything that must be trustworthy is deliberately absent:
 *
 * - **no `school_id`** — taken from the verified JWT,
 * - **no `bus_id` / `route_id`** — snapshotted from the trip the crew member
 *   is actually rostered on,
 * - **no timestamp** — `triggered_at` is the server clock, so an incident can
 *   be neither back-dated nor pre-dated.
 *
 * The position is optional (an SOS must always be possible, even without a GPS
 * fix) but never invented: the service stores exactly what the device
 * reported, or `null`. `latitude` and `longitude` must be supplied together —
 * a half pair would otherwise render as 0,0.
 */
export class SosDto implements EmergencySosRequest {
  /** Trip the alarm belongs to; defaults to the crew member's current trip. */
  @IsOptional()
  @IsUUID(undefined, { message: 'trip_id must be a valid UUID' })
  @Transform(nullableTrim)
  declare trip_id?: string | null;

  @IsEnum(EmergencyType, {
    message: `type must be one of: ${Object.values(EmergencyType).join(', ')}`,
  })
  @IsNotEmpty({ message: 'type is required' })
  type!: EmergencyType;

  @IsOptional()
  @IsString({ message: 'message must be a string' })
  @MaxLength(EMERGENCY_MESSAGE_MAX_LENGTH, {
    message: `message must be at most ${EMERGENCY_MESSAGE_MAX_LENGTH} characters`,
  })
  @Transform(nullableTrim)
  declare message?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'latitude must be a number' })
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  @Transform(nullableTrim)
  declare latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'longitude must be a number' })
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  @Transform(nullableTrim)
  declare longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'accuracy must be a number' })
  @Min(0, { message: 'accuracy must be at least 0' })
  @Max(GPS_ACCURACY_MAX_METERS, {
    message: `accuracy must be at most ${GPS_ACCURACY_MAX_METERS} metres`,
  })
  @Transform(nullableTrim)
  declare accuracy?: number | null;
}
