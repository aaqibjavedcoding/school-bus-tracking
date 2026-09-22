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
  @IsEnum(ReportType, { message: 'Please select a valid report.' })
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
  @IsInt({ message: 'Please enter a whole number for the page number.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page number.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page size.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page size.' })
  @Max(200, { message: 'Please enter a value of at most 200 for the page size.' })
  limit: number = 50;

  @IsOptional()
  @IsString({ message: 'Please enter a valid search text.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  search?: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid status.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the status.' })
  status?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid route.' })
  route_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid bus.' })
  bus_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid shift.' })
  shift_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid stop.' })
  stop_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid driver.' })
  driver_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid student.' })
  student_id?: string;

  @IsOptional()
  @IsEnum(TripStatus, { message: 'Please select a valid trip status.' })
  trip_status?: TripStatus;

  @IsOptional()
  @IsEnum(TripAttendanceStatus, { message: 'Please select a valid attendance status.' })
  attendance_status?: TripAttendanceStatus;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Please enter the start date as YYYY-MM-DD.' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Please enter the end date as YYYY-MM-DD.' })
  date_to?: string;

  @IsOptional()
  @IsEnum(DataFileFormat, { message: 'Please select a valid file format (one of: xlsx, csv).' })
  format?: DataFileFormat;
}
