import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StopCreateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/stops`.
 *
 * Implements the shared `StopCreateRequest` contract. There is intentionally
 * no `school_id` field: the tenant comes exclusively from the authenticated
 * user's JWT claims, and the global `ValidationPipe` (whitelist +
 * forbidNonWhitelisted) rejects any client-supplied `school_id` with 400.
 * `route_id` is validated against the authenticated school by the service.
 */
export class CreateStopDto implements StopCreateRequest {
  @IsUUID(undefined, { message: 'Please select a valid route.' })
  route_id!: string;

  @IsString({ message: 'Please enter a valid name.' })
  @IsNotEmpty({ message: 'Please enter the name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  @Transform(trimValue)
  name!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid address.' })
  @MaxLength(500, { message: 'Please enter at most 500 characters for the address.' })
  @Transform(trimValue)
  declare address?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Please enter a valid number for the latitude.' })
  @Min(-90, { message: 'Please enter a value between -90 and 90 for the latitude.' })
  @Max(90, { message: 'Please enter a value between -90 and 90 for the latitude.' })
  declare latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Please enter a valid number for the longitude.' })
  @Min(-180, { message: 'Please enter a value between -180 and 180 for the longitude.' })
  @Max(180, { message: 'Please enter a value between -180 and 180 for the longitude.' })
  declare longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the geofence radius in metres.' })
  @Min(10, {
    message: 'Please enter a value between 10 and 2000 for the geofence radius in metres.',
  })
  @Max(2000, {
    message: 'Please enter a value between 10 and 2000 for the geofence radius in metres.',
  })
  declare geofence_radius_meters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the stop order.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the stop order.' })
  declare sequence_number?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, {
    message: 'Please enter the estimated arrival time as HH:MM or HH:MM:SS.',
  })
  @Transform(trimValue)
  declare estimated_arrival_time?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
