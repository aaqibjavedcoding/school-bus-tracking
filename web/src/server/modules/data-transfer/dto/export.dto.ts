import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DataFileFormat, ExportDataset } from '@school-bus-tracking/shared-types';

/** `YYYY-MM-DD`, the shape every date filter in this codebase uses. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Route parameter of `GET /api/v1/exports/:dataset`. */
export class ExportDatasetParamDto {
  @IsEnum(ExportDataset, { message: 'Please select a valid dataset to export.' })
  dataset!: ExportDataset;
}

/**
 * Query of `GET /api/v1/exports/:dataset`.
 *
 * These are exactly the filters the list screens send, so "Export" always means
 * "export what I am looking at". A dataset silently ignores the filters it does
 * not understand — the alternative would be a 400 every time a shared filter
 * bar sent one extra key.
 *
 * There is deliberately no `school_id`: the tenant comes from the verified JWT
 * and nothing a client sends can change it.
 */
export class ExportQueryDto {
  @IsOptional()
  @IsEnum(DataFileFormat, { message: 'Please select a valid file format (one of: xlsx, csv).' })
  format: DataFileFormat = DataFileFormat.XLSX;

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
  @IsUUID('4', { message: 'Please select a valid stop.' })
  stop_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid driver.' })
  driver_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid conductor.' })
  conductor_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid parent.' })
  parent_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid student.' })
  student_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Please select a valid trip.' })
  trip_id?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Please enter the start date as YYYY-MM-DD.' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Please enter the end date as YYYY-MM-DD.' })
  date_to?: string;
}
