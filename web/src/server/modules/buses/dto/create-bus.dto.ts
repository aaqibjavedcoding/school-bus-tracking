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
  @IsString({ message: 'Please enter a valid registration number.' })
  @IsNotEmpty({ message: 'Please enter a value for the registration number.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the registration number.' })
  @Transform(trimValue)
  registration_number!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid bus number.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the bus number.' })
  @Transform(trimValue)
  declare bus_number?: string | null;

  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the capacity.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the capacity.' })
  capacity!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
