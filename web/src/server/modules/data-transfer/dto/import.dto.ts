import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import {
  DataFileFormat,
  ImportJobStatus,
  ImportMode,
  ImportModule,
} from '@school-bus-tracking/shared-types';

/**
 * DTOs for the import endpoints.
 *
 * The global `ValidationPipe` runs with `forbidNonWhitelisted: true`, so every
 * accepted field has to be declared here — an unexpected query or body key is a
 * 400, never a silently ignored value. The uploaded file itself does not pass
 * through the whitelist: it is handled by `FileInterceptor` and validated by
 * the controller against the size and extension rules.
 */

/** `YYYY-MM-DD`, the shape every date filter in this codebase uses. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Route parameter of the module-scoped import endpoints. */
export class ImportModuleParamDto {
  @IsEnum(ImportModule, { message: 'Please select a valid import module.' })
  module!: ImportModule;
}

/** Query of `GET /api/v1/imports/:module/template`. */
export class ImportTemplateQueryDto {
  @IsOptional()
  @IsEnum(DataFileFormat, { message: 'Please select a valid file format (one of: xlsx, csv).' })
  format: DataFileFormat = DataFileFormat.XLSX;
}

/**
 * Body of the validate and commit endpoints.
 *
 * `mode` arrives as a normal multipart text field alongside the file.
 */
export class ImportUploadDto {
  @IsOptional()
  @IsEnum(ImportMode, { message: 'Please select a valid import mode (one of: create, upsert).' })
  mode: ImportMode = ImportMode.CREATE;
}

/** Query of `GET /api/v1/imports/history`. */
export class ListImportJobsQueryDto {
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
  @IsEnum(ImportModule, { message: 'Please select a valid import module.' })
  module?: ImportModule;

  @IsOptional()
  @IsEnum(ImportJobStatus, { message: 'Please select a valid import status.' })
  status?: ImportJobStatus;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Please enter the start date as YYYY-MM-DD.' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'Please enter the end date as YYYY-MM-DD.' })
  date_to?: string;
}
