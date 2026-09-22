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
  @IsEnum(EmergencyStatus, {
    message: 'Please select a valid status (one of: OPEN, ACKNOWLEDGED, RESOLVED, CANCELLED).',
  })
  status?: EmergencyStatus;

  @IsOptional()
  @IsEnum(EmergencyType, { message: 'Please select a valid emergency type.' })
  type?: EmergencyType;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid trip.' })
  trip_id?: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid bus.' })
  bus_id?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'Please enter the start date as YYYY-MM-DD.' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'Please enter the end date as YYYY-MM-DD.' })
  date_to?: string;
}
