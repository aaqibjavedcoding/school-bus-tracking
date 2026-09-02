import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { DataFileFormat, ExportDataset } from '@school-bus-tracking/shared-types';

/** `YYYY-MM-DD`, the shape every date filter in this codebase uses. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Route parameter of `GET /api/v1/exports/:dataset`. */
export class ExportDatasetParamDto {
  @IsEnum(ExportDataset, { message: 'Unknown export dataset' })
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
  @IsEnum(DataFileFormat, { message: 'format must be xlsx or csv' })
  format: DataFileFormat = DataFileFormat.XLSX;

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
  @IsUUID('4', { message: 'conductor_id must be a valid UUID' })
  conductor_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'parent_id must be a valid UUID' })
  parent_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'student_id must be a valid UUID' })
  student_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'trip_id must be a valid UUID' })
  trip_id?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date_from must be in YYYY-MM-DD format' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date_to must be in YYYY-MM-DD format' })
  date_to?: string;
}
