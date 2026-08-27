import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query string of `GET /api/v1/routes`.
 *
 * `page` and `limit` mirror the shared pagination rules (
 * `@school-bus-tracking/validation`): page >= 1, limit 1..100, defaults 1/20.
 * `search` is an optional free-text filter applied to the route name and code.
 */
export class ListRoutesQueryDto {
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
}
