import { IsEnum, IsOptional } from 'class-validator';
import { BusDocumentType, BusDocumentUpdateRequest } from '@school-bus-tracking/shared-types';
import { DocumentFieldsDto } from './document-fields.dto';

/**
 * Body of `PATCH /api/v1/buses/:busId/documents/:id`.
 *
 * Every field is optional and `null` clears it. `document_type` may be
 * corrected in place (a misfiled insurance policy becomes a permit without
 * losing its history), but ownership stays fixed: no `school_id` and no
 * `bus_id` are accepted.
 */
export class UpdateBusDocumentDto extends DocumentFieldsDto implements BusDocumentUpdateRequest {
  @IsOptional()
  @IsEnum(BusDocumentType, {
    message: `document_type must be one of: ${Object.values(BusDocumentType).join(', ')}`,
  })
  declare document_type?: BusDocumentType;
}
