import { Type } from 'class-transformer';
import {
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
import {
  DataFileFormat,
  ReportType,
  TripAttendanceStatus,
  TripStatus,
} from '@school-bus-tracking/shared-types';

/** `YYYY-MM-DD`, the shape every date filter in this codebase uses. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Route parameter of `GET /api/v1/reports/:report`. */
export class ReportParamDto {
  @IsEnum(ReportType, { message: 'Unknown report' })
  report!: ReportType;
}

/**
 * Query of the report endpoints.
 *
 * A single DTO covers every report: each definition declares which of these
 * filters it honours, and the response echoes back exactly the ones that were
 * applied, so the UI never claims a filter took effect when it did not.
 */
export class ReportQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(200, { message: 'limit must be at most 200' })
  limit: number = 50;

  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(100, { message: 'search must be at most 100 characters' })
  search?: string;

  @IsOptional()
  @IsString({ message: 'status must be a string' })
  @MaxLength(32, { message: 'status must be at most 32 characters' })
  status?: string;

  @IsOptional()
  @IsUUID('4', { message: 'route_id must be a valid UUID' })
  route_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'bus_id must be a valid UUID' })
  bus_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'stop_id must be a valid UUID' })
  stop_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'driver_id must be a valid UUID' })
  driver_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'student_id must be a valid UUID' })
  student_id?: string;

  @IsOptional()
  @IsEnum(TripStatus, { message: 'Unknown trip status' })
  trip_status?: TripStatus;

  @IsOptional()
  @IsEnum(TripAttendanceStatus, { message: 'Unknown attendance status' })
  attendance_status?: TripAttendanceStatus;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date_from must be in YYYY-MM-DD format' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date_to must be in YYYY-MM-DD format' })
  date_to?: string;

  @IsOptional()
  @IsEnum(DataFileFormat, { message: 'format must be xlsx or csv' })
  format?: DataFileFormat;
}
