import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RunListQuery } from '@school-bus-tracking/shared-types';

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Query string of `GET /api/v1/runs` (also reused by the nested
 * `/routes/:id/runs` and `/buses/:busId/runs` reads, whose path parameter
 * overrides the matching filter).
 */
export class ListRunsQueryDto implements RunListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must be at most 100' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(100, { message: 'search must be at most 100 characters' })
  search?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'route_id must be a valid UUID' })
  route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'shift_id must be a valid UUID' })
  shift_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  bus_id?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;
}
