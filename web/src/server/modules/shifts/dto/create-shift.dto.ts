import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ShiftCreateRequest } from '@school-bus-tracking/shared-types';

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

/** `HH:MM` or `HH:MM:SS`, 24-hour wall clock — the shape PostgreSQL `time` accepts. */
export const SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/**
 * Body of `POST /api/v1/shifts`.
 *
 * A shift is a bell window (`docs/operating-model.md` §3.1): a name plus a
 * tenant-local wall-clock window. There is no `school_id` field — the tenant
 * comes exclusively from the JWT claims and the global ValidationPipe rejects
 * a client-supplied `school_id` with 400. The `end_time > start_time` rule is
 * enforced by the service (and by `ck_shifts_window` in the database).
 */
export class CreateShiftDto implements ShiftCreateRequest {
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(80, { message: 'name must be at most 80 characters' })
  @Transform(trimValue)
  name!: string;

  @IsString({ message: 'start_time must be a string' })
  @Matches(SHIFT_TIME_PATTERN, { message: 'start_time must be in HH:MM or HH:MM:SS format' })
  @Transform(trimValue)
  start_time!: string;

  @IsString({ message: 'end_time must be a string' })
  @Matches(SHIFT_TIME_PATTERN, { message: 'end_time must be in HH:MM or HH:MM:SS format' })
  @Transform(trimValue)
  end_time!: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
