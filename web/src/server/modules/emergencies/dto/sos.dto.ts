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
  @IsUUID(undefined, { message: 'Please select a valid trip.' })
  @Transform(nullableTrim)
  declare trip_id?: string | null;

  @IsEnum(EmergencyType, {
    message: `Please select a valid emergency type (one of: ${Object.values(EmergencyType).join(', ')}).`,
  })
  @IsNotEmpty({ message: 'Please select the emergency type.' })
  type!: EmergencyType;

  @IsOptional()
  @IsString({ message: 'Please enter a valid message.' })
  @MaxLength(EMERGENCY_MESSAGE_MAX_LENGTH, {
    message: `Please enter at most ${EMERGENCY_MESSAGE_MAX_LENGTH} characters for the message.`,
  })
  @Transform(nullableTrim)
  declare message?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Please enter a valid number for the latitude.' })
  @IsLatitude({ message: 'Please enter a value between -90 and 90 for the latitude.' })
  @Transform(nullableTrim)
  declare latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Please enter a valid number for the longitude.' })
  @IsLongitude({ message: 'Please enter a value between -180 and 180 for the longitude.' })
  @Transform(nullableTrim)
  declare longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Please enter the GPS accuracy in metres as a number.' })
  @Min(0, { message: 'Please enter a GPS accuracy of zero metres or more.' })
  @Max(GPS_ACCURACY_MAX_METERS, {
    message: `Please enter a GPS accuracy of at most ${GPS_ACCURACY_MAX_METERS} metres.`,
  })
  @Transform(nullableTrim)
  declare accuracy?: number | null;
}
