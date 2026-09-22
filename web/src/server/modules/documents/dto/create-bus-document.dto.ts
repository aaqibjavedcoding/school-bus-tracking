import { IsEnum, IsNotEmpty } from 'class-validator';
import { BusDocumentCreateRequest, BusDocumentType } from '@school-bus-tracking/shared-types';
import { DocumentCreateFieldsDto } from './document-fields.dto';

/**
 * Body of `POST /api/v1/buses/:busId/documents`.
 *
 * The document number and both dates are required: a bus document that cannot
 * be verified is not a compliance record (see `DocumentCreateFieldsDto`).
 * There is intentionally no `school_id`, no `bus_id` and no `status`: the
 * tenant and the owner come from the verified JWT and the route, and the
 * validity status is derived from `expiry_date` rather than asserted. A
 * client sending any of those fields is rejected by the global whitelist
 * pipe (see the DTO tests).
 */
export class CreateBusDocumentDto
  extends DocumentCreateFieldsDto
  implements BusDocumentCreateRequest
{
  @IsEnum(BusDocumentType, {
    message: `Please select a valid document type (one of: ${Object.values(BusDocumentType).join(', ')}).`,
  })
  @IsNotEmpty({ message: 'Please select the document type.' })
  document_type!: BusDocumentType;
}
