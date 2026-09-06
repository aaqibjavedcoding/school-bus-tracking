import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { ListInclude } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/buses`.
 *
 * `page` and `limit` mirror the shared pagination rules (
 * `@school-bus-tracking/validation`): page >= 1, limit 1..100, defaults 1/20.
 * `search` is an optional free-text filter applied to the registration number
 * and the fleet bus number.
 *
 * `include` selects the response shape: `full` (default) resolves the roster,
 * crew and today's-trip enrichment; `minimal` returns the raw bus fields
 * only, skipping every enrichment query — the cheap shape for dropdowns.
 */
export class ListBusesQueryDto {
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
  @IsIn(['full', 'minimal'] satisfies ListInclude[], {
    message: 'include must be either full or minimal',
  })
  include?: ListInclude;
}
