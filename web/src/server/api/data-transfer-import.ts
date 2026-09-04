/**
 * Endpoint definitions for the `data-transfer/import` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { BadRequestException, HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { bufferFileResponse, parseUploadedSpreadsheet, type UploadedSpreadsheet } from '../http/file-response';
import { DataFileFormat, ImportMode, ImportModule, UserRole } from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AuditService } from '../modules/audit';
import { IMPORT_ALLOWED_EXTENSIONS, IMPORT_ALLOWED_MIME_TYPES, MAX_IMPORT_FILE_BYTES, sanitizeFileName } from '../modules/data-transfer/excel/excel.util';
import { IMPORT_FILE_REQUIRED_MESSAGE, IMPORT_FILE_TOO_LARGE_MESSAGE, IMPORT_FILE_TYPE_MESSAGE } from '../modules/data-transfer/data-transfer.constants';
import { ImportModuleParamDto, ImportTemplateQueryDto, ImportUploadDto, ListImportJobsQueryDto } from '../modules/data-transfer/dto/import.dto';
import { ImportHistoryService } from '../modules/data-transfer/import/import-history.service';
import { ImportTemplateService } from '../modules/data-transfer/import/import-template.service';
import { ImportService } from '../modules/data-transfer/import/import.service';

/** `GET /api/v1/imports/modules` */
export const getImportsModules: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return container().importTemplates().listModules();
  },
};

/** `GET /api/v1/imports/history` */
export const getImportsHistory: EndpointDefinition<unknown, ListImportJobsQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListImportJobsQueryDto,
  handler: async ({ user, query }) => {
    const schoolId = user.school_id as string;
    return container().importHistory().list(schoolId, query);
  },};

/** `GET /api/v1/imports/history/:id` */
export const getImportsHistoryById: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id'], '4');
    return container().importHistory().findOne(schoolId, id);
  },
};

/**
 * Validates the upload envelope before a single byte is parsed.
 *
 * Byte-for-byte the controller's `requireSpreadsheet`: extension *and*
 * declared MIME type are both checked, the name is sanitised before it is
 * echoed anywhere, and the three rejection messages are unchanged.
 */
function requireSpreadsheet(file: UploadedSpreadsheet | undefined): {
  originalName: string;
  buffer: Buffer;
} {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException(IMPORT_FILE_REQUIRED_MESSAGE);
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new BadRequestException(IMPORT_FILE_TOO_LARGE_MESSAGE);
  }

  const name = sanitizeFileName(file.originalname, 'import');
  const extension = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (!IMPORT_ALLOWED_EXTENSIONS.includes(extension as '.xlsx' | '.csv')) {
    throw new BadRequestException(IMPORT_FILE_TYPE_MESSAGE);
  }
  if (!IMPORT_ALLOWED_MIME_TYPES.has(file.mimetype ?? '')) {
    throw new BadRequestException(IMPORT_FILE_TYPE_MESSAGE);
  }

  return { originalName: name, buffer: file.buffer };
}

/** `GET /api/v1/imports/history/:id/error-file` */
export const getImportsHistoryByIdErrorfile: EndpointDefinition = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = user.school_id as string;
    const id = parseUuidParam(params['id'], '4');
    const file = await container().importHistory().buildErrorFile(schoolId, user.id, id);
    return bufferFileResponse(
      file.buffer,
      sanitizeFileName(file.fileName, 'download.xlsx'),
      DataFileFormat.XLSX,
    );
  },
};

/** `GET /api/v1/imports/:module/template` */
export const getImportsByModuleTemplate: EndpointDefinition<unknown, ImportTemplateQueryDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  status: HttpStatus.OK,
  queryType: ImportTemplateQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = user.school_id as string;
    const routeParams = await validateDto(ImportModuleParamDto, params, 'param');
    const typedQuery = query;

    const file = await container()
      .importTemplates()
      .buildTemplate(routeParams.module, typedQuery.format);

    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.IMPORT_TEMPLATE_DOWNLOAD,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: null,
      metadata: { module: routeParams.module, format: typedQuery.format },
    });

    return bufferFileResponse(
      file.buffer,
      sanitizeFileName(file.fileName, `download.${file.format}`),
      file.format,
    );
  },};

/** `POST /api/v1/imports/:module/validate` — dry run, writes nothing. */
export const postImportsByModuleValidate: EndpointDefinition<unknown, ImportUploadDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'data_import',
  status: HttpStatus.OK,
  queryType: ImportUploadDto,
  handler: async ({ user, query, params, raw }) => {
    const schoolId = user.school_id as string;
    const routeParams = await validateDto(ImportModuleParamDto, params, 'param');
    const typedQuery = query;
    const file = await parseUploadedSpreadsheet(raw, 'file', MAX_IMPORT_FILE_BYTES);
    const upload = requireSpreadsheet(file);

    return container()
      .imports()
      .validate(
        { schoolId, userId: user.id },
        routeParams.module as ImportModule,
        typedQuery.mode ?? ImportMode.CREATE,
        upload,
      );
  },};

/** `POST /api/v1/imports/:module/commit` — writes the valid rows. */
export const postImportsByModuleCommit: EndpointDefinition<unknown, ImportUploadDto> = {
  roles: [UserRole.SCHOOL_ADMIN],
  rateLimit: 'data_import',
  status: HttpStatus.OK,
  queryType: ImportUploadDto,
  handler: async ({ user, query, params, raw }) => {
    const schoolId = user.school_id as string;
    const routeParams = await validateDto(ImportModuleParamDto, params, 'param');
    const typedQuery = query;
    const file = await parseUploadedSpreadsheet(raw, 'file', MAX_IMPORT_FILE_BYTES);
    const upload = requireSpreadsheet(file);

    return container()
      .imports()
      .commit(
        { schoolId, userId: user.id },
        routeParams.module as ImportModule,
        typedQuery.mode ?? ImportMode.CREATE,
        upload,
      );
  },};
