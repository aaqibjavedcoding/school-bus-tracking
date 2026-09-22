import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  DOCUMENT_OWNER_TYPE_VALUES,
  DocumentOverviewQuery,
} from '@school-bus-tracking/shared-types';
// Types referenced in decorated signatures must be imported as types when
// `isolatedModules` + `emitDecoratorMetadata` are on (the Next build).
import type { DocumentOwnerType } from '@school-bus-tracking/shared-types';

/**
 * Query string of `GET /api/v1/documents/overview`.
 *
 * `compliance` narrows the fleet to the resources that need attention
 * (`attention` = anything required is missing, expired or expiring soon) or to
 * the fully compliant ones — the two views an operator actually works from.
 */
export class DocumentOverviewQueryDto implements DocumentOverviewQuery {
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
  @IsEnum(DOCUMENT_OWNER_TYPE_VALUES, {
    message: 'Please select a valid document owner type (one of: BUS, DRIVER).',
  })
  owner_type?: DocumentOwnerType;

  @IsOptional()
  @IsEnum(['compliant', 'attention'], {
    message: 'Please select a valid compliance filter (one of: compliant, attention).',
  })
  compliance?: 'compliant' | 'attention';

  @IsOptional()
  @IsString({ message: 'Please enter a valid search text.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  search?: string;
}
