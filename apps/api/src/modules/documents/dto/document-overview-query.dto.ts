import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  DOCUMENT_OWNER_TYPE_VALUES,
  DocumentOverviewQuery,
  DocumentOwnerType,
} from '@school-bus-tracking/shared-types';

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
  @IsEnum(DOCUMENT_OWNER_TYPE_VALUES, {
    message: 'owner_type must be BUS or DRIVER',
  })
  owner_type?: DocumentOwnerType;

  @IsOptional()
  @IsEnum(['compliant', 'attention'], {
    message: 'compliance must be compliant or attention',
  })
  compliance?: 'compliant' | 'attention';

  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(100, { message: 'search must be at most 100 characters' })
  search?: string;
}
