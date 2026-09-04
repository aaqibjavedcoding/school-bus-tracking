import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import {
  RouteAssignmentCreateRequest,
  RouteAssignmentRole,
} from '@school-bus-tracking/shared-types';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Body of `POST /api/v1/route-assignments`.
 *
 * The existing RouteAssignment model stores one row per crew member and role.
 * A route therefore receives one request for its DRIVER and one for its
 * CONDUCTOR. `school_id` is intentionally absent: the controller supplies it
 * from the verified JWT claims. The only accepted roles are the two
 * operational staff roles; arbitrary UserRole values can never be persisted.
 */
export class CreateRouteAssignmentDto implements RouteAssignmentCreateRequest {
  @IsUUID(undefined, { message: 'route_id must be a valid UUID' })
  route_id!: string;

  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  bus_id!: string;

  @IsUUID(undefined, { message: 'user_id must be a valid UUID' })
  user_id!: string;

  @IsEnum(RouteAssignmentRole, {
    message: 'role must be DRIVER or CONDUCTOR',
  })
  role!: RouteAssignmentRole;

  @IsStringDateOnly()
  @IsNotEmpty({ message: 'effective_from is required' })
  effective_from!: string;

  @IsOptional()
  @IsStringDateOnly()
  declare effective_to?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}

/**
 * `class-validator` has no built-in DATEONLY validator. Keeping the
 * decorator local makes the API reject timestamps and malformed month/day
 * values while the service performs the final calendar-range check.
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
