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
import { RouteRunCreateRequest, RunCreateRequest } from '@school-bus-tracking/shared-types';

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
 * Body of `POST /api/v1/routes/:id/runs` — the nested create.
 *
 * The route comes from the path. `shift_id` and `bus_id` are optional and
 * nullable: a run without a shift is treated by the conflict rules as
 * occupying the whole day; a run without a bus is one whose fleet is still
 * undecided. `code` is optional and derived from the route code when absent.
 *
 * There is deliberately **no** `is_default` field: it is server-only, set once
 * by the backfill / route auto-provisioning, and a client-supplied value is
 * rejected as an unknown key by the global ValidationPipe
 * (`docs/operating-model.md` §3.2, §8.2). Same for `school_id`.
 */
export class CreateRouteRunDto implements RouteRunCreateRequest {
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

/** Body of `POST /api/v1/runs` — the nested body plus the target route. */
export class CreateRunDto extends CreateRouteRunDto implements RunCreateRequest {
  @IsUUID(undefined, { message: 'Please select a valid route.' })
  route_id!: string;
}
