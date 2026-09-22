import { IsEnum, IsOptional } from 'class-validator';
import { DriverDocumentType, DriverDocumentUpdateRequest } from '@school-bus-tracking/shared-types';
import { DocumentFieldsDto } from './document-fields.dto';

/**
 * Body of `PATCH /api/v1/drivers/:driverId/documents/:id` — every field is
 * optional, so a partial update stays partial. Ownership is immutable through
 * the API, and a conductor's paperwork is corrected here too (conductors share
 * this resource). The document number and the two dates can be corrected but
 * never cleared — an explicit `null` is a 400 (see `DocumentFieldsDto`), while
 * notes and file references still clear with `null`.
 */
export class UpdateDriverDocumentDto
  extends DocumentFieldsDto
  implements DriverDocumentUpdateRequest
{
  @IsOptional()
  @IsEnum(DriverDocumentType, {
    message: `Please select a valid document type (one of: ${Object.values(DriverDocumentType).join(', ')}).`,
  })
  declare document_type?: DriverDocumentType;
}
