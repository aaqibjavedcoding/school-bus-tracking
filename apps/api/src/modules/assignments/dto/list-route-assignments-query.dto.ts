import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { RouteAssignmentListQuery, RouteAssignmentRole } from '@school-bus-tracking/shared-types';

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/** Query string of `GET /api/v1/route-assignments`. */
export class ListRouteAssignmentsQueryDto implements RouteAssignmentListQuery {
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
  @IsUUID(undefined, { message: 'route_id must be a valid UUID' })
  route_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  bus_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'user_id must be a valid UUID' })
  user_id?: string;

  @IsOptional()
  @IsEnum(RouteAssignmentRole, { message: 'role must be DRIVER or CONDUCTOR' })
  role?: RouteAssignmentRole;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  is_active?: boolean;
}
