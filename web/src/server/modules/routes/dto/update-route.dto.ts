import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RouteUpdateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `PATCH /api/v1/routes/:id`.
 *
 * Every field is optional (partial update). There is no `school_id` field at
 * all — ownership can never be changed through the API, and a client supplied
 * `school_id` is rejected by the global ValidationPipe.
 */
export class UpdateRouteDto implements RouteUpdateRequest {
  @IsOptional()
  @IsString({ message: 'Please enter a valid name.' })
  @IsNotEmpty({ message: 'Please enter the name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  @Transform(trimValue)
  declare name?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid code.' })
  @IsNotEmpty({ message: 'Please enter the code.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the code.' })
  @Transform(trimValue)
  declare code?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid description.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the description.' })
  @Transform(trimValue)
  declare description?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
