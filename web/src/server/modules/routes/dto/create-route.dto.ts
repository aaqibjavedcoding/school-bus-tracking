import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RouteCreateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/routes`.
 *
 * Implements the shared `RouteCreateRequest` contract. There is intentionally
 * no `school_id` field: the tenant comes exclusively from the authenticated
 * user's JWT claims, and the global `ValidationPipe` (whitelist +
 * forbidNonWhitelisted) rejects any client-supplied `school_id` with 400.
 */
export class CreateRouteDto implements RouteCreateRequest {
  @IsString({ message: 'Please enter a valid name.' })
  @IsNotEmpty({ message: 'Please enter the name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  @Transform(trimValue)
  name!: string;

  @IsString({ message: 'Please enter a valid code.' })
  @IsNotEmpty({ message: 'Please enter the code.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the code.' })
  @Transform(trimValue)
  code!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid description.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the description.' })
  @Transform(trimValue)
  declare description?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
