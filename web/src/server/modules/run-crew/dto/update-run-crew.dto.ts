import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { RunCrewRole, RunCrewUpdateRequest } from '@school-bus-tracking/shared-types';
import { IsStringDateOnly } from './create-run-crew.dto';

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Body of `PATCH /api/v1/run-crew/:id`.
 *
 * Every field is optional. `run_id` is immutable — roster the person onto
 * another run with a new row — and is rejected as an unknown key. No
 * `school_id`.
 */
export class UpdateRunCrewDto implements RunCrewUpdateRequest {
  @IsOptional()
  @IsUUID(undefined, { message: 'user_id must be a valid UUID' })
  declare user_id?: string;

  @IsOptional()
  @IsEnum(RunCrewRole, { message: 'role must be DRIVER or CONDUCTOR' })
  declare role?: RunCrewRole;

  @IsOptional()
  @IsStringDateOnly()
  declare effective_from?: string;

  @IsOptional()
  @IsStringDateOnly()
  declare effective_to?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
