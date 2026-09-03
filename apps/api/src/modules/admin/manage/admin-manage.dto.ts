import { IsUUID } from 'class-validator';
import { ExportDatasetParamDto } from '../../../modules/data-transfer/dto/export.dto';
import { ImportModuleParamDto } from '../../../modules/data-transfer/dto/import.dto';
import { ReportParamDto } from '../../../modules/reports/dto/report-query.dto';

/**
 * Route-parameter DTOs of the assisted-management surface.
 *
 * The global `ValidationPipe` runs with `forbidNonWhitelisted: true`, so a
 * whole-`@Param()` DTO must declare **every** parameter the route carries. The
 * managed routes add `:schoolId` in front of the tenant routes' parameters,
 * so they need these thin extensions — the school id is declared explicitly
 * (and UUID-validated) instead of being silently stripped or rejected.
 *
 * The handlers still read the school id through the guarded request context /
 * `@Param(MANAGED_SCHOOL_PARAM)`; the DTO declaration exists purely so the
 * whitelist matches the path.
 */
export class AdminManageImportModuleParamDto extends ImportModuleParamDto {
  @IsUUID(4, { message: 'schoolId must be a uuid' })
  declare schoolId: string;
}

export class AdminManageExportDatasetParamDto extends ExportDatasetParamDto {
  @IsUUID(4, { message: 'schoolId must be a uuid' })
  declare schoolId: string;
}

export class AdminManageReportParamDto extends ReportParamDto {
  @IsUUID(4, { message: 'schoolId must be a uuid' })
  declare schoolId: string;
}
