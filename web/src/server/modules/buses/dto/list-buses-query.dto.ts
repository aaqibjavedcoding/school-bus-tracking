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
  @IsIn(['full', 'minimal'] satisfies ListInclude[], {
    message: 'Please select a valid detail level (one of: full, minimal).',
  })
  include?: ListInclude;
}
