import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ShiftListQuery } from '@school-bus-tracking/shared-types';

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Query string of `GET /api/v1/shifts`.
 *
 * `page` and `limit` mirror the shared pagination rules
 * (`@school-bus-tracking/validation`): page >= 1, limit 1..100, defaults 1/20.
 * `search` is a case-insensitive filter over the shift name.
 */
export class ListShiftsQueryDto implements ShiftListQuery {
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
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;
}
