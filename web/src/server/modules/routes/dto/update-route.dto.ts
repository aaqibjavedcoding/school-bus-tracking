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
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MaxLength(150, { message: 'name must be at most 150 characters' })
  @Transform(trimValue)
  declare name?: string;

  @IsOptional()
  @IsString({ message: 'code must be a string' })
  @IsNotEmpty({ message: 'code cannot be empty' })
  @MaxLength(32, { message: 'code must be at most 32 characters' })
  @Transform(trimValue)
  declare code?: string;

  @IsOptional()
  @IsString({ message: 'description must be a string' })
  @MaxLength(2000, { message: 'description must be at most 2000 characters' })
  @Transform(trimValue)
  declare description?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
