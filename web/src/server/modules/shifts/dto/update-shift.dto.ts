import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ShiftUpdateRequest } from '@school-bus-tracking/shared-types';
import { SHIFT_TIME_PATTERN } from './create-shift.dto';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Body of `PATCH /api/v1/shifts/:id`.
 *
 * Every field is optional (partial update). There is no `school_id` field at
 * all — ownership can never be changed through the API.
 */
export class UpdateShiftDto implements ShiftUpdateRequest {
  @IsOptional()
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MaxLength(80, { message: 'name must be at most 80 characters' })
  @Transform(trimValue)
  declare name?: string;

  @IsOptional()
  @IsString({ message: 'start_time must be a string' })
  @Matches(SHIFT_TIME_PATTERN, { message: 'start_time must be in HH:MM or HH:MM:SS format' })
  @Transform(trimValue)
  declare start_time?: string;

  @IsOptional()
  @IsString({ message: 'end_time must be a string' })
  @Matches(SHIFT_TIME_PATTERN, { message: 'end_time must be in HH:MM or HH:MM:SS format' })
  @Transform(trimValue)
  declare end_time?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
