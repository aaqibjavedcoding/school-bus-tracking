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
  @IsString({ message: 'registration_number must be a string' })
  @IsNotEmpty({ message: 'registration_number cannot be empty' })
  @MaxLength(32, { message: 'registration_number must be at most 32 characters' })
  @Transform(trimValue)
  declare registration_number?: string;

  @IsOptional()
  @IsString({ message: 'bus_number must be a string' })
  @MaxLength(32, { message: 'bus_number must be at most 32 characters' })
  @Transform(trimValue)
  declare bus_number?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'capacity must be an integer' })
  @Min(1, { message: 'capacity must be at least 1' })
  declare capacity?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
