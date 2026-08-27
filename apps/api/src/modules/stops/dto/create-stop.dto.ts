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
  @IsUUID(undefined, { message: 'route_id must be a valid UUID' })
  route_id!: string;

  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(150, { message: 'name must be at most 150 characters' })
  @Transform(trimValue)
  name!: string;

  @IsOptional()
  @IsString({ message: 'address must be a string' })
  @MaxLength(500, { message: 'address must be at most 500 characters' })
  @Transform(trimValue)
  declare address?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'latitude must be a number' })
  @Min(-90, { message: 'latitude must be between -90 and 90' })
  @Max(90, { message: 'latitude must be between -90 and 90' })
  declare latitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'longitude must be a number' })
  @Min(-180, { message: 'longitude must be between -180 and 180' })
  @Max(180, { message: 'longitude must be between -180 and 180' })
  declare longitude?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'geofence_radius_meters must be an integer' })
  @Min(10, { message: 'geofence_radius_meters must be between 10 and 2000' })
  @Max(2000, { message: 'geofence_radius_meters must be between 10 and 2000' })
  declare geofence_radius_meters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'sequence_number must be an integer' })
  @Min(1, { message: 'sequence_number must be at least 1' })
  declare sequence_number?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, {
    message: 'estimated_arrival_time must be in HH:MM or HH:MM:SS format',
  })
  @Transform(trimValue)
  declare estimated_arrival_time?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
