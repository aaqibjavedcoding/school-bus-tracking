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
  @IsString({ message: 'Please enter a valid name.' })
  @IsNotEmpty({ message: 'Please enter the name.' })
  @MaxLength(80, { message: 'Please enter at most 80 characters for the name.' })
  @Transform(trimValue)
  declare name?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid start time.' })
  @Matches(SHIFT_TIME_PATTERN, { message: 'Please enter the start time as HH:MM or HH:MM:SS.' })
  @Transform(trimValue)
  declare start_time?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid end time.' })
  @Matches(SHIFT_TIME_PATTERN, { message: 'Please enter the end time as HH:MM or HH:MM:SS.' })
  @Transform(trimValue)
  declare end_time?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
