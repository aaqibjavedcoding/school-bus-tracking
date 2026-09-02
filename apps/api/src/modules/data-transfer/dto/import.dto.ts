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
  @IsEnum(ImportModule, { message: 'Unknown import module' })
  module!: ImportModule;
}

/** Query of `GET /api/v1/imports/:module/template`. */
export class ImportTemplateQueryDto {
  @IsOptional()
  @IsEnum(DataFileFormat, { message: 'format must be xlsx or csv' })
  format: DataFileFormat = DataFileFormat.XLSX;
}

/**
 * Body of the validate and commit endpoints.
 *
 * `mode` arrives as a normal multipart text field alongside the file.
 */
export class ImportUploadDto {
  @IsOptional()
  @IsEnum(ImportMode, { message: 'mode must be create or upsert' })
  mode: ImportMode = ImportMode.CREATE;
}

/** Query of `GET /api/v1/imports/history`. */
export class ListImportJobsQueryDto {
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
  @IsEnum(ImportModule, { message: 'Unknown import module' })
  module?: ImportModule;

  @IsOptional()
  @IsEnum(ImportJobStatus, { message: 'Unknown import status' })
  status?: ImportJobStatus;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date_from must be in YYYY-MM-DD format' })
  date_from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date_to must be in YYYY-MM-DD format' })
  date_to?: string;
}
