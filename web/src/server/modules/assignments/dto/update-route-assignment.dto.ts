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
  @IsUUID(undefined, { message: 'Please select a valid route.' })
  declare route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid bus.' })
  declare bus_id?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid user.' })
  declare user_id?: string;

  @IsOptional()
  @IsEnum(RouteAssignmentRole, {
    message: 'Please select a valid role (one of: DRIVER, CONDUCTOR).',
  })
  declare role?: RouteAssignmentRole;

  @IsOptional()
  @IsStringDateOnly('effective date')
  @IsNotEmpty({ message: 'Please enter the effective date.' })
  declare effective_from?: string;

  @IsOptional()
  @IsStringDateOnly('end date')
  declare effective_to?: string | null;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}

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
