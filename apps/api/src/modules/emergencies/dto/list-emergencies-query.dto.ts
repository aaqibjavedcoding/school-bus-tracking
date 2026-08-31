import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { EmergencyStatus, EmergencyType } from '@school-bus-tracking/shared-types';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query string of `GET /api/v1/emergencies`.
 *
 * `date_from` / `date_to` select an inclusive range of UTC calendar days of
 * `triggered_at` — the server-owned event time, never a client clock.
 */
export class ListEmergenciesQueryDto {
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
  @IsEnum(EmergencyStatus, {
    message: 'status must be OPEN, ACKNOWLEDGED, RESOLVED or CANCELLED',
  })
  status?: EmergencyStatus;

  @IsOptional()
  @IsEnum(EmergencyType, { message: 'type is not a valid emergency type' })
  type?: EmergencyType;

  @IsOptional()
  @IsUUID(undefined, { message: 'trip_id must be a valid UUID' })
  trip_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'bus_id must be a valid UUID' })
  bus_id?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'date_from must be in YYYY-MM-DD format' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'date_to must be in YYYY-MM-DD format' })
  date_to?: string;
}
