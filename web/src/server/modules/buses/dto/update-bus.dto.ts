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
import { BusUpdateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `PATCH /api/v1/buses/:id`.
 *
 * Every field is optional (partial update). There is no `school_id` field at
 * all — ownership can never be changed through the API, and a client supplied
 * `school_id` is rejected by the global ValidationPipe.
 */
export class UpdateBusDto implements BusUpdateRequest {
  @IsOptional()
  @IsString({ message: 'Please enter a valid registration number.' })
  @IsNotEmpty({ message: 'Please enter a value for the registration number.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the registration number.' })
  @Transform(trimValue)
  declare registration_number?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid bus number.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the bus number.' })
  @Transform(trimValue)
  declare bus_number?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the capacity.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the capacity.' })
  declare capacity?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
