import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BusCreateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/buses`.
 *
 * Implements the shared `BusCreateRequest` contract. There is intentionally
 * no `school_id` field: the tenant comes exclusively from the authenticated
 * user's JWT claims, and the global `ValidationPipe` (whitelist +
 * forbidNonWhitelisted) rejects any client-supplied `school_id` with 400.
 */
export class CreateBusDto implements BusCreateRequest {
  @IsString({ message: 'registration_number must be a string' })
  @IsNotEmpty({ message: 'registration_number is required' })
  @MaxLength(32, { message: 'registration_number must be at most 32 characters' })
  @Transform(trimValue)
  registration_number!: string;

  @IsOptional()
  @IsString({ message: 'bus_number must be a string' })
  @MaxLength(32, { message: 'bus_number must be at most 32 characters' })
  @Transform(trimValue)
  declare bus_number?: string | null;

  @Type(() => Number)
  @IsInt({ message: 'capacity must be an integer' })
  @Min(1, { message: 'capacity must be at least 1' })
  capacity!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
