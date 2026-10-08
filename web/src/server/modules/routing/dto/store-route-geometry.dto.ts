import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import type {
  RouteGeometryLeg,
  RouteGeometryLineString,
  RouteGeometryManeuver,
  RouteGeometryStoreRequest,
} from '@school-bus-tracking/shared-types';

/**
 * Body of `PUT /api/v1/routes/:id/geometry`.
 *
 * This is the write half of the geometry cache, and it is deliberately
 * STRICT: the body is a piece of map data that every driver, conductor and
 * parent will later be shown as "the road the bus takes", so a malformed
 * geometry is rejected here rather than cached and served. The rules:
 *
 *  - `geometry` is a GeoJSON LineString with AT LEAST TWO positions, and
 *    every position is exactly `[longitude, latitude]` — finite numbers in
 *    WGS-84 range (a cached partial or out-of-range polyline is worse than
 *    no polyline);
 *  - `distance_meters` / `duration_seconds` are finite numbers >= 0 (NaN
 *    and Infinity are rejected — `@IsNumber` rejects both by default);
 *  - `legs` / `maneuvers` are validated one level deep, with the same
 *    finite-number and position rules;
 *  - `provider` names the engine (`osrm`) and is capped at the column width;
 *  - `computed_at` is an optional ISO-8601 timestamp (defaults to now).
 *
 * There is no `school_id` and no `stops_hash` field: the tenant comes from
 * the JWT and the cache key is computed server-side from the route's
 * current located stops, so a caller cannot pin a geometry to a stop list
 * the route no longer has (and the next GET is a cache hit by
 * construction).
 */

/** Hard ceiling on polyline positions — real engine output stays far below. */
export const MAX_GEOMETRY_POSITIONS = 50_000;
/** Hard ceiling on legs (a route has at most 1000 stops ⇒ 999 legs). */
export const MAX_GEOMETRY_LEGS = 1_000;
/** Hard ceiling on maneuvers per leg (turn-by-turn steps of one section). */
export const MAX_GEOMETRY_MANEUVERS = 10_000;

/** One GeoJSON position: exactly `[longitude, latitude]`, finite, WGS-84. */
@ValidatorConstraint({ name: 'routeGeometryPosition', async: false })
class RouteGeometryPositionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== 2) {
      return false;
    }
    const [longitude, latitude] = value;
    return (
      typeof longitude === 'number' &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180 &&
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90
    );
  }

  defaultMessage(): string {
    return 'Every position must be a [longitude, latitude] pair of finite numbers (longitude -180..180, latitude -90..90).';
  }
}

/** GeoJSON LineString — the polyline the maps draw. */
export class RouteGeometryLineStringDto implements RouteGeometryLineString {
  @IsIn(['LineString'], { message: 'geometry.type must be "LineString".' })
  type!: 'LineString';

  @IsArray({ message: 'geometry.coordinates must be a list of [longitude, latitude] pairs.' })
  @ArrayMinSize(2, { message: 'geometry.coordinates needs at least two positions.' })
  @ArrayMaxSize(MAX_GEOMETRY_POSITIONS, {
    message: `geometry.coordinates accepts at most ${MAX_GEOMETRY_POSITIONS} positions.`,
  })
  @Validate(RouteGeometryPositionConstraint, { each: true })
  coordinates!: [number, number][];
}

/** One turn-by-turn instruction point along a leg. */
export class RouteGeometryManeuverDto implements RouteGeometryManeuver {
  @IsString({ message: 'Every maneuver needs a valid type.' })
  @IsNotEmpty({ message: 'Every maneuver needs a type.' })
  type!: string;

  /**
   * OSRM omits `modifier` on maneuvers with no direction (depart/arrive);
   * the shared contract carries `null` there, so an omitted value is
   * normalised to `null` instead of failing validation.
   */
  @IsOptional()
  @IsString({ message: 'modifier must be a string or null.' })
  @Transform(({ value }) => (value === undefined ? null : value))
  modifier!: string | null;

  @IsString({ message: 'road_name must be a string.' })
  road_name!: string;

  @IsNumber({}, { message: 'distance_meters must be a finite number.' })
  @Min(0, { message: 'distance_meters must not be negative.' })
  distance_meters!: number;

  @Validate(RouteGeometryPositionConstraint, {
    message: 'location must be a [longitude, latitude] pair of finite numbers.',
  })
  location!: [number, number];
}

/** One stop-to-stop section of the route. */
export class RouteGeometryLegDto implements RouteGeometryLeg {
  @IsNumber({}, { message: 'Every leg needs a finite distance_meters.' })
  @Min(0, { message: 'Leg distance_meters must not be negative.' })
  distance_meters!: number;

  @IsNumber({}, { message: 'Every leg needs a finite duration_seconds.' })
  @Min(0, { message: 'Leg duration_seconds must not be negative.' })
  duration_seconds!: number;

  @IsArray({ message: 'maneuvers must be a list.' })
  @ArrayMaxSize(MAX_GEOMETRY_MANEUVERS, {
    message: `A leg accepts at most ${MAX_GEOMETRY_MANEUVERS} maneuvers.`,
  })
  @ValidateNested({ each: true })
  @Type(() => RouteGeometryManeuverDto)
  maneuvers!: RouteGeometryManeuverDto[];
}

/** The full `PUT /api/v1/routes/:id/geometry` body. */
export class StoreRouteGeometryDto implements RouteGeometryStoreRequest {
  @IsIn(['road'], { message: 'status must be "road".' })
  status!: 'road';

  @ValidateNested({ message: 'geometry must be a GeoJSON LineString.' })
  @Type(() => RouteGeometryLineStringDto)
  geometry!: RouteGeometryLineStringDto;

  @IsNumber({}, { message: 'distance_meters must be a finite number.' })
  @Min(0, { message: 'distance_meters must not be negative.' })
  distance_meters!: number;

  @IsNumber({}, { message: 'duration_seconds must be a finite number.' })
  @Min(0, { message: 'duration_seconds must not be negative.' })
  duration_seconds!: number;

  @IsArray({ message: 'legs must be a list of stop-to-stop sections.' })
  @ArrayMaxSize(MAX_GEOMETRY_LEGS, {
    message: `legs accepts at most ${MAX_GEOMETRY_LEGS} sections.`,
  })
  @ValidateNested({ each: true })
  @Type(() => RouteGeometryLegDto)
  legs!: RouteGeometryLegDto[];

  @IsString({ message: 'provider must be a string.' })
  @IsNotEmpty({ message: 'provider must name the routing engine.' })
  @MaxLength(32, { message: 'provider accepts at most 32 characters.' })
  provider!: string;

  @IsOptional()
  @IsDateString({}, { message: 'computed_at must be an ISO-8601 timestamp.' })
  declare computed_at?: string;
}
