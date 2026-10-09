import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { MissingRouteGeometryListQuery } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/admin/routes/geometry/missing`.
 *
 * Same pagination rules as every other list (`ListRoutesQueryDto`): page
 * >= 1, limit 1..100. The platform backfill walks the pages with the
 * maximum page size.
 */
export class ListMissingRouteGeometryQueryDto implements MissingRouteGeometryListQuery {
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
}
