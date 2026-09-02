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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  DataFileFormat,
  ImportMode,
  ImportModule,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RateLimit } from '../../../common/rate-limit';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AuditService } from '../../audit';
import {
  IMPORT_ALLOWED_EXTENSIONS,
  IMPORT_ALLOWED_MIME_TYPES,
  MAX_IMPORT_FILE_BYTES,
  sanitizeFileName,
} from '../excel/excel.util';
import {
  IMPORT_FILE_REQUIRED_MESSAGE,
  IMPORT_FILE_TOO_LARGE_MESSAGE,
  IMPORT_FILE_TYPE_MESSAGE,
} from '../data-transfer.constants';
import {
  ImportModuleParamDto,
  ImportTemplateQueryDto,
  ImportUploadDto,
  ListImportJobsQueryDto,
} from '../dto/import.dto';
import { ImportHistoryService } from './import-history.service';
import { ImportTemplateService } from './import-template.service';
import { ImportService } from './import.service';

/** Shape multer hands to the handler. Typed locally to avoid a global import. */
interface UploadedSpreadsheet {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Bulk import endpoints.
 *
 * Every handler is `SCHOOL_ADMIN` only and takes its tenant from the verified
 * JWT (`@CurrentUser('school_id')`), never from the request. A SUPER_ADMIN has
 * `school_id === null` and is rejected by the role guard, so there is no path
 * by which a platform operator can import into a school's data.
 *
 * ## File handling
 *
 * Uploads are kept **in memory** and discarded when the request ends. Nothing
 * is written to disk: a roster file contains names, phone numbers and medical
 * notes, and the safest place for it is nowhere. The 5 MB / row-count caps are
 * enforced before parsing so a hostile upload cannot exhaust the process.
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class ImportController {
  constructor(
    private readonly templates: ImportTemplateService,
    private readonly imports: ImportService,
    private readonly history: ImportHistoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `GET /api/v1/imports/modules`
   *
   * Metadata for every importable module: columns, requiredness, examples and
   * the natural key. The web wizard renders itself entirely from this.
   */
  @Get('modules')
  listModules() {
    return this.templates.listModules();
  }

  /**
   * `GET /api/v1/imports/history`
   *
   * Paginated import history of the authenticated school.
   */
  @Get('history')
  @RateLimit('read_heavy')
  async listHistory(
    @CurrentUser('school_id') schoolId: string,
    @Query() query: ListImportJobsQueryDto,
  ) {
    return this.history.list(schoolId, query);
  }

  /**
   * `GET /api/v1/imports/history/:id`
   *
   * One run with its stored per-row errors. A job belonging to another school
   * returns the same generic 404 as one that does not exist.
   */
  @Get('history/:id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.history.findOne(schoolId, id);
  }

  /**
   * `GET /api/v1/imports/history/:id/error-file`
   *
   * Rebuilds the `<file>_import_errors.xlsx` workbook for a past run.
   */
  @Get('history/:id/error-file')
  async downloadErrorFile(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.history.buildErrorFile(schoolId, userId, id);
    // `@Res()` without passthrough deliberately bypasses TransformInterceptor:
    // a spreadsheet must not be wrapped in the JSON success envelope.
    sendFile(response, file.buffer, file.fileName, DataFileFormat.XLSX);
    response.end(file.buffer);
  }

  /**
   * `GET /api/v1/imports/:module/template`
   *
   * Downloads the blank template for a module: header row, an inline notes row
   * documenting each column, one example row and an Instructions sheet.
   */
  @Get(':module/template')
  async downloadTemplate(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') userId: string,
    @Param() params: ImportModuleParamDto,
    @Query() query: ImportTemplateQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.templates.buildTemplate(params.module, query.format);

    await this.audit.log({
      school_id: schoolId,
      actor_user_id: userId,
      action: AUDIT_ACTIONS.IMPORT_TEMPLATE_DOWNLOAD,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: null,
      metadata: { module: params.module, format: query.format },
    });

    sendFile(response, file.buffer, file.fileName, file.format);
    response.end(file.buffer);
  }

  /**
   * `POST /api/v1/imports/:module/validate`
   *
   * Dry run. Parses and validates the whole file, reports every row's outcome
   * and writes nothing to the domain tables.
   */
  @Post(':module/validate')
  @HttpCode(HttpStatus.OK)
  @RateLimit('data_import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async validate(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') userId: string,
    @Param() params: ImportModuleParamDto,
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @Query() query: ImportUploadDto,
  ) {
    const upload = this.requireSpreadsheet(file);
    return this.imports.validate(
      { schoolId, userId },
      params.module as ImportModule,
      query.mode ?? ImportMode.CREATE,
      upload,
    );
  }

  /**
   * `POST /api/v1/imports/:module/commit`
   *
   * Writes the valid rows. The file is re-uploaded and re-validated server-side
   * rather than referencing a stored draft, so the decision to write is always
   * made against the database as it is *now* — and no copy of the admin's
   * spreadsheet ever has to be retained between the two steps.
   */
  @Post(':module/commit')
  @HttpCode(HttpStatus.OK)
  @RateLimit('data_import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }))
  async commit(
    @CurrentUser('school_id') schoolId: string,
    @CurrentUser('id') userId: string,
    @Param() params: ImportModuleParamDto,
    @UploadedFile() file: UploadedSpreadsheet | undefined,
    @Query() query: ImportUploadDto,
  ) {
    const upload = this.requireSpreadsheet(file);
    return this.imports.commit(
      { schoolId, userId },
      params.module as ImportModule,
      query.mode ?? ImportMode.CREATE,
      upload,
    );
  }

  /**
   * Validates the upload envelope before a single byte is parsed.
   *
   * Extension *and* declared MIME type are both checked, and the file name is
   * sanitised before it is stored or echoed into a header — a name is
   * attacker-controlled text and is treated as such.
   */
  private requireSpreadsheet(file: UploadedSpreadsheet | undefined): {
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
}

/**
 * Sets download headers on a raw (`@Res()`) response.
 *
 * `Content-Disposition` carries both the ASCII fallback and the RFC 5987
 * encoded name, and `X-Content-Type-Options: nosniff` stops a browser from
 * re-interpreting a spreadsheet as something executable.
 */
export function sendFile(
  response: Response,
  buffer: Buffer,
  fileName: string,
  format: DataFileFormat,
): void {
  const safeName = sanitizeFileName(fileName, `download.${format}`);
  const ascii = safeName.replace(/[^\x20-\x7e]/g, '_');

  response.setHeader(
    'Content-Type',
    format === DataFileFormat.CSV
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  );
  response.setHeader('Content-Length', String(buffer.length));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
}
