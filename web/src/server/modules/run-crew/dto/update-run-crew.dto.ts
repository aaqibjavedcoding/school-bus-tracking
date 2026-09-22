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
  @IsUUID(undefined, { message: 'Please select a valid user.' })
  declare user_id?: string;

  @IsOptional()
  @IsEnum(RunCrewRole, { message: 'Please select a valid role (one of: DRIVER, CONDUCTOR).' })
  declare role?: RunCrewRole;

  @IsOptional()
  @IsStringDateOnly('effective date')
  declare effective_from?: string;

  @IsOptional()
  @IsStringDateOnly('end date')
  declare effective_to?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
