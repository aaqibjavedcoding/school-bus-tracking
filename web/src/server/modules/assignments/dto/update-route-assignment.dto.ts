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
  RouteAssignmentRole,
  RouteAssignmentUpdateRequest,
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

/** Body of `PATCH /api/v1/route-assignments/:id`.
 *
 * All fields are optional. Updating `role` and `user_id` is supported, but
 * the service validates the resulting pair together, so a DRIVER can never
 * be assigned with the CONDUCTOR role (or vice versa).
 */
export class UpdateRouteAssignmentDto implements RouteAssignmentUpdateRequest {
  @IsOptional()
  @IsUUID(undefined, { message: 'route_id must be a valid UUID' })
  declare route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  declare bus_id?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'user_id must be a valid UUID' })
  declare user_id?: string;

  @IsOptional()
  @IsEnum(RouteAssignmentRole, {
    message: 'role must be DRIVER or CONDUCTOR',
  })
  declare role?: RouteAssignmentRole;

  @IsOptional()
  @IsStringDateOnly()
  @IsNotEmpty({ message: 'effective_from cannot be empty' })
  declare effective_from?: string;

  @IsOptional()
  @IsStringDateOnly()
  declare effective_to?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}

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
