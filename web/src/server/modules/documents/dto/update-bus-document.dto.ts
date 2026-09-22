import { IsEnum, IsOptional } from 'class-validator';
import { BusDocumentType, BusDocumentUpdateRequest } from '@school-bus-tracking/shared-types';
import { DocumentFieldsDto } from './document-fields.dto';

/**
 * Body of `PATCH /api/v1/buses/:busId/documents/:id`.
 *
 * Every field is optional, so a partial update stays partial. `document_type`
 * may be corrected in place (a misfiled insurance policy becomes a permit
 * without losing its history), but ownership and the compliance facts stay
 * intact: no `school_id`/`bus_id` are accepted, and the document number and
 * the two dates can be corrected but never cleared — an explicit `null` is a
 * 400 (see `DocumentFieldsDto`). Notes and file references still clear with
 * `null`.
 */
export class UpdateBusDocumentDto extends DocumentFieldsDto implements BusDocumentUpdateRequest {
  @IsOptional()
  @IsEnum(BusDocumentType, {
    message: `Please select a valid document type (one of: ${Object.values(BusDocumentType).join(', ')}).`,
  })
  declare document_type?: BusDocumentType;
}
