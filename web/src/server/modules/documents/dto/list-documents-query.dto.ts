import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DocumentStatus } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/buses/:busId/documents` and
 * `GET /api/v1/drivers/:driverId/documents`.
 *
 * `status` filters on the *derived* validity (valid / expiring soon /
 * expired), so it never matches a stored column — the service computes it per
 * row exactly as it is reported to the client.
 */
export class ListDocumentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page number.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page number.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page size.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page size.' })
  @Max(100, { message: 'Please enter a value of at most 100 for the page size.' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'Please enter a valid document type.' })
  @MaxLength(64, { message: 'Please enter at most 64 characters for the document type.' })
  document_type?: string;

  @IsOptional()
  @IsEnum(DocumentStatus, {
    message: 'Please select a valid status (one of: VALID, EXPIRING_SOON, EXPIRED).',
  })
  status?: DocumentStatus;
}
