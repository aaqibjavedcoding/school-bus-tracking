import { IsEnum, IsNotEmpty } from 'class-validator';
import { BusDocumentCreateRequest, BusDocumentType } from '@school-bus-tracking/shared-types';
import { DocumentFieldsDto } from './document-fields.dto';

/**
 * Body of `POST /api/v1/buses/:busId/documents`.
 *
 * There is intentionally no `school_id`, no `bus_id` and no `status`: the
 * tenant and the owner come from the verified JWT and the route, and the
 * validity status is derived from `expiry_date` rather than asserted. A
 * client sending any of those fields is rejected by the global whitelist
 * pipe (see the DTO tests).
 */
export class CreateBusDocumentDto extends DocumentFieldsDto implements BusDocumentCreateRequest {
  @IsEnum(BusDocumentType, {
    message: `document_type must be one of: ${Object.values(BusDocumentType).join(', ')}`,
  })
  @IsNotEmpty({ message: 'document_type is required' })
  document_type!: BusDocumentType;
}
