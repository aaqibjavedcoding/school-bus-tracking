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
  DocumentComplianceResponse,
  DocumentDeleteResponse,
  DriverDocumentListResponse,
  DriverDocumentResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { DocumentComplianceService } from './document-compliance.service';
import { DocumentsService } from './documents.service';
import { CreateDriverDocumentDto, ListDocumentsQueryDto, UpdateDriverDocumentDto } from './dto';

/**
 * School-admin compliance documents of one driver
 * (`/api/v1/drivers/:driverId/documents`) — the driving licence first, plus
 * whatever else the school requires (medical, police verification, …).
 *
 * The owner is taken from the route, the tenant from the verified JWT, and the
 * service additionally pins the owner's role to `DRIVER`, so the endpoint can
 * never manage the documents of a conductor, a parent or another school's
 * employee.
 */
@Controller('drivers/:driverId/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class DriverDocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly compliance: DocumentComplianceService,
  ) {}

  /** `POST .../documents` — add a document (licence, medical, …). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('school_id') schoolId: string,
    @Param('driverId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    driverId: string,
    @Body() dto: CreateDriverDocumentDto,
  ): Promise<DriverDocumentResponse> {
    return this.documents.createDriverDocument(schoolId, driverId, dto);
  }

  /** `GET .../documents` — paginated, optionally filtered by type/status. */
  @Get()
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Param('driverId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    driverId: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DriverDocumentListResponse> {
    return this.documents.listDriverDocuments(schoolId, driverId, query);
  }

  /** `GET .../documents/compliance` — missing / valid / expiring / expired. */
  @Get('compliance')
  async complianceSummary(
    @CurrentUser('school_id') schoolId: string,
    @Param('driverId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    driverId: string,
  ): Promise<DocumentComplianceResponse> {
    return this.compliance.getDriverCompliance(schoolId, driverId);
  }

  /** `GET .../documents/:id` */
  @Get(':id')
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('driverId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    driverId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<DriverDocumentResponse> {
    return this.documents.findOneDriverDocument(schoolId, driverId, id);
  }

  /** `PATCH .../documents/:id` — partial update; `null` clears a field. */
  @Patch(':id')
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Param('driverId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    driverId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateDriverDocumentDto,
  ): Promise<DriverDocumentResponse> {
    return this.documents.updateDriverDocument(schoolId, driverId, id, dto);
  }

  /** `DELETE .../documents/:id` — soft delete (paranoid model). */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser('school_id') schoolId: string,
    @Param('driverId', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    driverId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<DocumentDeleteResponse> {
    return this.documents.removeDriverDocument(schoolId, driverId, id);
  }
}
