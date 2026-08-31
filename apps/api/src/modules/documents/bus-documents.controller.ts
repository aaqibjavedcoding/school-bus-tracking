import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  BusDocumentListResponse,
  BusDocumentResponse,
  DocumentComplianceResponse,
  DocumentDeleteResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { DocumentComplianceService } from './document-compliance.service';
import { DocumentsService } from './documents.service';
import { CreateBusDocumentDto, ListDocumentsQueryDto, UpdateBusDocumentDto } from './dto';

/**
 * School-admin compliance documents of one bus (`/api/v1/buses/:busId/documents`).
 *
 * The owner bus is taken from the route, the tenant from the verified JWT — a
 * client supplies neither, and the service re-checks both against the
 * database so a forged id only ever yields a generic `404`.
 *
 * `GET .../compliance` is declared before `GET .../:id` so Nest resolves the
 * literal path first.
 */
@Controller('buses/:busId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class BusDocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly compliance: DocumentComplianceService,
  ) {}

  /** `POST .../documents` — add a compliance document to the bus. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('school_id') schoolId: string,
    @Param('busId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    busId: string,
    @Body() dto: CreateBusDocumentDto,
  ): Promise<BusDocumentResponse> {
    return this.documents.createBusDocument(schoolId, busId, dto);
  }

  /** `GET .../documents` — paginated, optionally filtered by type/status. */
  @Get()
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Param('busId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    busId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<BusDocumentListResponse> {
    return this.documents.listBusDocuments(schoolId, busId, query);
  }

  /** `GET .../documents/compliance` — missing / valid / expiring / expired. */
  @Get('compliance')
  async complianceSummary(
    @CurrentUser('school_id') schoolId: string,
    @Param('busId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    busId: string,
  ): Promise<DocumentComplianceResponse> {
    return this.compliance.getBusCompliance(schoolId, busId);
  }

  /** `GET .../documents/:id` */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('busId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    busId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<BusDocumentResponse> {
    return this.documents.findOneBusDocument(schoolId, busId, id);
  }

  /** `PATCH .../documents/:id` — partial update; `null` clears a field. */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('busId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    busId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateBusDocumentDto,
  ): Promise<BusDocumentResponse> {
    return this.documents.updateBusDocument(schoolId, busId, id, dto);
  }

  /** `DELETE .../documents/:id` — soft delete (paranoid model). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('busId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    busId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<DocumentDeleteResponse> {
    return this.documents.removeBusDocument(schoolId, busId, id);
  }
}
