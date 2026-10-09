import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { BadRequestException } from '../../../framework';
import type { MissingRouteGeometryListQuery } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/admin/routes/geometry/missing`.
 *
 * Same pagination rules as every other list (`ListRoutesQueryDto`): page
 * >= 1, limit 1..100. The platform backfill walks the pages with the
 * maximum page size.
 *
 * The optional `bbox` is the OSM extract box the engine was built from, in
 * the same order OSRM uses on its `coordinate` parameter: `minLon,minLat,
 * maxLon,maxLat`. A malformed box is 400 — `class-validator` enforces the
 * shape; this DTO enforces the ranges and the `min < max` rule (a 4-tuple
 * where min == max is empty, so we reject it).
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

  /**
   * `minLon,minLat,maxLon,maxLat` — must be a 4-tuple of finite numbers with
   * lon in [-180, 180], lat in [-90, 90], and min strictly less than max on
   * every axis. The class-validator `@Matches` keeps the wire shape honest
   * (four comma-separated floats, no scientific notation, no whitespace),
   * the runtime check enforces the range and the ordering — class-validator
   * has no decorator for "two out of four numbers in a given range".
   */
  @IsOptional()
  @IsString({ message: 'Please enter the bounding box as "minLon,minLat,maxLon,maxLat".' })
  @Matches(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/, {
    message:
      'Please enter the bounding box as four comma-separated numbers: "minLon,minLat,maxLon,maxLat".',
  })
  bbox?: string;
}

/**
 * The parsed form of a valid `bbox` query: 4 finite numbers, lon in
 * [-180, 180], lat in [-90, 90], strictly min < max on each axis.
 */
export interface ParsedBoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Parse the validated `bbox` string. The `@Matches` decorator on the DTO
 * already pinned the wire shape; this is the range + ordering check, and
 * it returns a typed handle for the service.
 */
export function parseBoundingBox(raw: string): ParsedBoundingBox {
  const [a, b, c, d] = raw.split(',').map((part) => Number(part));
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    throw new BadRequestException(
      'The bounding box must contain four finite numbers: "minLon,minLat,maxLon,maxLat".',
    );
  }
  if (a < -180 || a > 180 || c < -180 || c > 180) {
    throw new BadRequestException('The bounding box longitudes must lie in [-180, 180].');
  }
  if (b < -90 || b > 90 || d < -90 || d > 90) {
    throw new BadRequestException('The bounding box latitudes must lie in [-90, 90].');
  }
  if (a >= c) {
    throw new BadRequestException('The bounding box minLon must be strictly less than maxLon.');
  }
  if (b >= d) {
    throw new BadRequestException('The bounding box minLat must be strictly less than maxLat.');
  }
  return { minLon: a, minLat: b, maxLon: c, maxLat: d };
}

/** True when the (lon, lat) point lies inside the parsed box (inclusive). */
export function isInsideBbox(
  bbox: ParsedBoundingBox,
  longitude: number,
  latitude: number,
): boolean {
  return (
    longitude >= bbox.minLon &&
    longitude <= bbox.maxLon &&
    latitude >= bbox.minLat &&
    latitude <= bbox.maxLat
  );
}
