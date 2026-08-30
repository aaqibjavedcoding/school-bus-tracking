import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TripListQuery, TripStatus } from '@school-bus-tracking/shared-types';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query string of `GET /api/v1/trips`.
 *
 * Dispatchers filter by day (`date`) or by an inclusive day range
 * (`date_from`/`date_to`) on top of the usual status, route, bus and crew
 * filters. The tenant is never a query parameter: it comes from the JWT.
 */
export class ListTripsQueryDto implements TripListQuery {
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
  @IsEnum(TripStatus, {
    message: `status must be one of ${Object.values(TripStatus).join(', ')}`,
  })
  status?: TripStatus;

  @IsOptional()
  @IsUUID(undefined, { message: 'route_id must be a valid UUID' })
  route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  bus_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'driver_id must be a valid UUID' })
  driver_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'conductor_id must be a valid UUID' })
  conductor_id?: string;

  @IsOptional()
  @IsStringDateOnly()
  date?: string;

  @IsOptional()
  @IsStringDateOnly()
  date_from?: string;

  @IsOptional()
  @IsStringDateOnly()
  date_to?: string;
}

/**
 * `class-validator` has no built-in DATEONLY validator. Keeping the decorator
 * local makes the API reject timestamps and malformed month/day values while
 * the service performs the final range check.
 */
function IsStringDateOnly(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    Matches(DATE_ONLY_PATTERN, {
      message: `${String(propertyKey)} must be in YYYY-MM-DD format`,
    })(target, propertyKey);
    IsDateString(
      { strict: true },
      {
        message: `${String(propertyKey)} must be a valid calendar date`,
      },
    )(target, propertyKey);
  };
}
