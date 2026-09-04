import { IsEnum, IsOptional } from 'class-validator';
import { DriverDocumentType, DriverDocumentUpdateRequest } from '@school-bus-tracking/shared-types';
import { DocumentFieldsDto } from './document-fields.dto';

/**
 * Body of `PATCH /api/v1/drivers/:driverId/documents/:id` — every field is
 * optional and `null` clears it. Ownership is immutable through the API.
 */
export class UpdateDriverDocumentDto
  extends DocumentFieldsDto
  implements DriverDocumentUpdateRequest
{
  @IsOptional()
  @IsEnum(DriverDocumentType, {
    message: `document_type must be one of: ${Object.values(DriverDocumentType).join(', ')}`,
  })
  declare document_type?: DriverDocumentType;
}
