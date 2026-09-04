import { IsEnum, IsNotEmpty } from 'class-validator';
import { DriverDocumentCreateRequest, DriverDocumentType } from '@school-bus-tracking/shared-types';
import { DocumentFieldsDto } from './document-fields.dto';

/**
 * Body of `POST /api/v1/drivers/:driverId/documents`.
 *
 * The driving licence is the headline document of this resource
 * (`DRIVING_LICENSE` with its `document_number` set to the licence number);
 * the same endpoint records every other document the school requires.
 *
 * No `school_id`, no `driver_id` and no `status` are accepted — the tenant and
 * the owner come from the JWT / route and validity is always derived.
 */
export class CreateDriverDocumentDto
  extends DocumentFieldsDto
  implements DriverDocumentCreateRequest
{
  @IsEnum(DriverDocumentType, {
    message: `document_type must be one of: ${Object.values(DriverDocumentType).join(', ')}`,
  })
  @IsNotEmpty({ message: 'document_type is required' })
  document_type!: DriverDocumentType;
}
