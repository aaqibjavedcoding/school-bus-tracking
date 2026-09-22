import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import type { ListInclude } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/stops`.
 *
 * `page` and `limit` mirror the shared pagination rules (
 * `@school-bus-tracking/validation`): page >= 1, limit 1..100, defaults 1/20.
 * `search` is an optional free-text filter applied to the stop name and
 * address; `route_id` narrows the list to one route of the school.
 *
 * `include` selects the response shape: `full` (default) returns every stop
 * column; `minimal` returns only the picker/label fields (id, route link,
 * name, order) for a smaller payload on the large stop lists.
 */
export class ListStopsQueryDto {
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
  @IsIn(['full', 'minimal'] satisfies ListInclude[], {
    message: 'Please select a valid detail level (one of: full, minimal).',
  })
  include?: ListInclude;
}
