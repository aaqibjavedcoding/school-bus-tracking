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
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must be at most 100' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'document_type must be a string' })
  @MaxLength(64, { message: 'document_type must be at most 64 characters' })
  document_type?: string;

  @IsOptional()
  @IsEnum(DocumentStatus, {
    message: 'status must be VALID, EXPIRING_SOON or EXPIRED',
  })
  status?: DocumentStatus;
}
