import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { RunUpdateRequest } from '@school-bus-tracking/shared-types';

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
 * Body of `PATCH /api/v1/runs/:id`.
 *
 * Every field is optional (partial update); explicit `null` clears the
 * nullable `shift_id` / `bus_id`. `route_id` is immutable (a run *is* a pass
 * over one route) and `is_default` is server-only — neither is declared here,
 * so the global ValidationPipe rejects both as unknown keys. No `school_id`.
 */
export class UpdateRunDto implements RunUpdateRequest {
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID(undefined, { message: 'Please select a valid shift.' })
  declare shift_id?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID(undefined, { message: 'Please select a valid bus.' })
  declare bus_id?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid code.' })
  @IsNotEmpty({ message: 'Please enter the code.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the code.' })
  @Transform(trimValue)
  declare code?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
