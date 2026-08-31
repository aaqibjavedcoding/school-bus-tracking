import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { DocumentRequirementsResponse, UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { DocumentRequirementsService } from './document-requirements.service';
import { DocumentRequirementsQueryDto, UpdateDocumentRequirementsDto } from './dto';

/**
 * Required / optional configuration of the compliance catalogue
 * (`/api/v1/document-requirements`).
 *
 * A school decides which documents it actually enforces — one district treats
 * a police verification as mandatory, another does not — and how early it
 * wants to be warned before an expiry. Types the school never configures keep
 * the built-in default, so nothing has to be seeded when a tenant is created.
 */
@Controller('document-requirements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN)
export class DocumentRequirementsController {
  constructor(private readonly requirements: DocumentRequirementsService) {}

  /**
   * `GET /api/v1/document-requirements?owner_type=BUS`
   *
   * Returns the *effective* configuration: every catalogue type with the
   * school's override applied and an `is_customized` flag telling the UI
   * whether the value came from the school or from the default catalogue.
   */
  @Get()
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Query() query: DocumentRequirementsQueryDto,
  ): Promise<DocumentRequirementsResponse> {
    return this.requirements.list(schoolId, query.owner_type);
  }

  /**
   * `PUT /api/v1/document-requirements`
   *
   * Replaces the school's overrides for the supplied document types. It is a
   * `PUT` of a *partial* set, not a full replacement: types that are not
   * mentioned are left untouched, so saving one screen cannot reset another.
   */
  @Put()
  async update(
    @CurrentUser('school_id') schoolId: string,
    @Body() dto: UpdateDocumentRequirementsDto,
  ): Promise<DocumentRequirementsResponse> {
    return this.requirements.update(schoolId, dto.owner_type, dto);
  }
}
