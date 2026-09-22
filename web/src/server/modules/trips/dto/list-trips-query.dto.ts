import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { ListInclude, TripListQuery } from '@school-bus-tracking/shared-types';
import { TripStatus } from '@school-bus-tracking/shared-types';

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
  @IsEnum(TripStatus, {
    message: `Please select a valid status (one of: ${Object.values(TripStatus).join(', ')}).`,
  })
  status?: TripStatus;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid route.' })
  route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid run.' })
  run_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid bus.' })
  bus_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid driver.' })
  driver_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid conductor.' })
  conductor_id?: string;

  @IsOptional()
  @IsStringDateOnly('trip date')
  date?: string;

  @IsOptional()
  @IsStringDateOnly('start date')
  date_from?: string;

  @IsOptional()
  @IsStringDateOnly('end date')
  date_to?: string;

  @IsOptional()
  @IsIn(['full', 'minimal'] satisfies ListInclude[], {
    message: 'Please select a valid detail level (one of: full, minimal).',
  })
  include?: ListInclude;
}

/**
 * `class-validator` has no built-in DATEONLY validator. Keeping the decorator
 * local makes the API reject timestamps and malformed month/day values while
 * the service performs the final range check.
 */
function IsStringDateOnly(label: string): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    Matches(DATE_ONLY_PATTERN, {
      message: `Please enter the ${label} as YYYY-MM-DD.`,
    })(target, propertyKey);
    IsDateString(
      { strict: true },
      {
        message: `Please enter a real calendar date for the ${label}.`,
      },
    )(target, propertyKey);
  };
}
