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
  @IsUUID(undefined, { message: 'shift_id must be a valid UUID' })
  declare shift_id?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  declare bus_id?: string | null;

  @IsOptional()
  @IsString({ message: 'code must be a string' })
  @IsNotEmpty({ message: 'code cannot be empty' })
  @MaxLength(32, { message: 'code must be at most 32 characters' })
  @Transform(trimValue)
  declare code?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
