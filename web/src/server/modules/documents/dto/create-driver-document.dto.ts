import { IsEnum, IsNotEmpty } from 'class-validator';
import { DriverDocumentCreateRequest, DriverDocumentType } from '@school-bus-tracking/shared-types';
import { DocumentCreateFieldsDto } from './document-fields.dto';

/**
 * Body of `POST /api/v1/drivers/:driverId/documents`.
 *
 * The driving licence is the headline document of this resource
 * (`DRIVING_LICENSE` with its `document_number` set to the licence number);
 * the same endpoint records every other document the school requires.
 *
 * No `school_id`, no `driver_id` and no `status` are accepted — the tenant and
 * the owner come from the JWT / route and validity is always derived. The
 * document number and both dates are required, which is what makes a licence
 * (or a conductor's police verification) a verifiable record rather than a
 * bare type: conductors share this resource, exactly as they share the
 * `DRIVING_LICENSE` / verification paperwork rules.
 */
export class CreateDriverDocumentDto
  extends DocumentCreateFieldsDto
  implements DriverDocumentCreateRequest
{
  @IsEnum(DriverDocumentType, {
    message: `Please select a valid document type (one of: ${Object.values(DriverDocumentType).join(', ')}).`,
  })
  @IsNotEmpty({ message: 'Please select the document type.' })
  document_type!: DriverDocumentType;
}
