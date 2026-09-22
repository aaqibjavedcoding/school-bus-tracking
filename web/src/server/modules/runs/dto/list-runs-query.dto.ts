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
  @IsInt({ message: 'Please enter a whole number for the page number.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page number.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page size.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page size.' })
  @Max(100, { message: 'Please enter a value of at most 100 for the page size.' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'Please enter a valid search text.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  search?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid route.' })
  route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid shift.' })
  shift_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid bus.' })
  bus_id?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  is_active?: boolean;
}
