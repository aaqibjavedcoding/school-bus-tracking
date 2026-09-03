import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  DataFileFormat,
  ImportMode,
  ImportModule,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RateLimit } from '../../../common/rate-limit';
import {
  AUDIT_ACTIONS,
  AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
  AUDIT_ENTITY_TYPES,
  AuditService,
} from '../../audit';
import {
  IMPORT_ALLOWED_EXTENSIONS,
  IMPORT_ALLOWED_MIME_TYPES,
  MAX_IMPORT_FILE_BYTES,
  sanitizeFileName,
} from '../../../modules/data-transfer/excel/excel.util';
import {
  IMPORT_FILE_REQUIRED_MESSAGE,
  IMPORT_FILE_TOO_LARGE_MESSAGE,
  IMPORT_FILE_TYPE_MESSAGE,
} from '../../../modules/data-transfer/data-transfer.constants';
import {
  ImportTemplateQueryDto,
  ImportUploadDto,
  ListImportJobsQueryDto,
} from '../../../modules/data-transfer/dto/import.dto';
import { AdminManageImportModuleParamDto } from './admin-manage.dto';
import { sendFile } from '../../../modules/data-transfer/import/import.controller';
import { ImportHistoryService } from '../../../modules/data-transfer/import/import-history.service';
import { ImportTemplateService } from '../../../modules/data-transfer/import/import-template.service';
import { ImportService } from '../../../modules/data-transfer/import/import.service';
import { AssistedSessionService } from './assisted-session.service';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

/** Shape multer hands to the handler. Typed locally to avoid a global import. */
interface UploadedSpreadsheet {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const uuidParam = () => new ParseUUIDPipe({ version: '4' });

/**
 * Assisted bulk import into the managed school.
 *
 * The exact pipeline the school admin uses — {@link ImportTemplateService},
 * {@link ImportService}, {@link ImportHistoryService} — with two differences:
 *
 * 1. the tenant comes from the guarded route parameter, and the file cannot
 *    influence it: the workbook columns define rows, and the services force
 *    `school_id` on every written row;
 * 2. the actor stays the Super Admin, and each audit row is marked with
 *    `context: assisted_management` plus the open session id, so the school's
 *    own audit view shows platform-operator activity as such.
 *
 * Validation, duplicate detection, error workbook, import history, transaction
 * handling and plan limits are the existing implementations — nothing is
 * duplicated.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/imports`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageImportsController {
  constructor(
    private readonly templates: ImportTemplateService,
    private readonly imports: ImportService,
    private readonly history: ImportHistoryService,
    private readonly audit: AuditService,
    private readonly sessions: AssistedSessionService,
  ) {}

  /** Metadata for every importable module (the wizard renders from this). */
  @Get('modules')
  listModules() {
    return this.templates.listModules();
  }

  /** Paginated import history of the managed school. */
  @Get('history')
  @RateLimit('read_heavy')
  listHistory(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListImportJobsQueryDto,
  ) {
    return this.history.list(schoolId, query);
  }

  /** One run with its stored per-row errors; foreign ids get the generic 404. */
  @Get('history/:id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.history.findOne(schoolId, id);
  }

  /** Rebuilds the `<file>_import_errors.xlsx` workbook for a past run. */
  @Get('history/:id/error-file')
  async downloadErrorFile(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Req() request: Request & { user?: { id?: string } },
    @Param('id', uuidParam()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const userId = this.requireActor(request);
    const context = await this.assistedContext(schoolId, userId);
    const file = await this.history.buildErrorFile(schoolId, userId, id, context);
    sendFile(response, file.buffer, file.fileName, DataFileFormat.XLSX);
    response.end(file.buffer);
  }

  /** Downloads the blank template for a module. */
  @Get(':module/template')
  async downloadTemplate(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Req() request: Request & { user?: { id?: string } },
    @Param() params: AdminManageImportModuleParamDto,
    @Query() query: ImportTemplateQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const userId = this.requireActor(request);
    const context = await this.assistedContext(schoolId, userId);
    const file = await this.templates.buildTemplate(params.module, query.format);

    await this.audit.log({
      school_id: schoolId,
      actor_user_id: userId,
      action: AUDIT_ACTIONS.IMPORT_TEMPLATE_DOWNLOAD,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: null,
      metadata: {
        module: params.module,
        format: query.format,
        context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
        assisted_session_id: context?.assisted_session_id ?? null,
      },
    });

    sendFile(response, file.buffer, file.fileName, file.format);
    response.end(file.buffer);
  }

  /** Dry run: parses and validates, writes nothing to the domain tables. */
  @Post(':module/validate')
  @HttpCode(HttpStatus.OK)
  @RateLimit('data_import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async validate(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Req() request: Request & { user?: { id?: string } },
    @Param() params: AdminManageImportModuleParamDto,
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @Query() query: ImportUploadDto,
  ) {
    const userId = this.requireActor(request);
    const upload = requireSpreadsheet(file);
    return this.imports.validate(
      { schoolId, userId, context: await this.assistedContext(schoolId, userId) },
      params.module as ImportModule,
      query.mode ?? ImportMode.CREATE,
      upload,
    );
  }

  /** Writes the valid rows — re-uploaded and re-validated server-side. */
  @Post(':module/commit')
  @HttpCode(HttpStatus.OK)
  @RateLimit('data_import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async commit(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Req() request: Request & { user?: { id?: string } },
    @Param() params: AdminManageImportModuleParamDto,
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @Query() query: ImportUploadDto,
  ) {
    const userId = this.requireActor(request);
    const upload = requireSpreadsheet(file);
    return this.imports.commit(
      { schoolId, userId, context: await this.assistedContext(schoolId, userId) },
      params.module as ImportModule,
      query.mode ?? ImportMode.CREATE,
      upload,
    );
  }

  private requireActor(request: Request & { user?: { id?: string } }): string {
    const userId = request.user?.id;
    if (!userId) {
      // Unreachable behind JwtAuthGuard; a loud failure beats an anonymous audit row.
      throw new BadRequestException('Authenticated actor is required');
    }
    return userId;
  }

  private async assistedContext(schoolId: string, userId: string) {
    return {
      assisted_session_id: await this.sessions.findOpenSessionId(schoolId, userId),
    };
  }
}

/** Mirrors the tenant controller's upload envelope validation. */
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
