import { IsEnum, IsNotEmpty } from 'class-validator';
import {
  DOCUMENT_OWNER_TYPE_VALUES,
  DocumentOwnerType,
  DocumentRequirementsListQuery,
} from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/document-requirements`.
 *
 * `owner_type` is mandatory: the two catalogues (bus and driver documents)
 * are configured independently, and the response always lists the *effective*
 * configuration — built-in defaults with the school's own overrides applied.
 */
export class DocumentRequirementsQueryDto implements DocumentRequirementsListQuery {
  @IsEnum(DOCUMENT_OWNER_TYPE_VALUES, {
    message: 'owner_type must be BUS or DRIVER',
  })
  @IsNotEmpty({ message: 'owner_type is required' })
  owner_type!: DocumentOwnerType;
}
