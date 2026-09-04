import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DOCUMENT_OWNER_TYPE_VALUES,
  DocumentRequirementInput,
  DocumentRequirementsUpdateRequest,
} from '@school-bus-tracking/shared-types';
// Types referenced in decorated signatures must be imported as types when
// `isolatedModules` + `emitDecoratorMetadata` are on (the Next build).
import type {
  DocumentOwnerType,
} from '@school-bus-tracking/shared-types';
import {
  MAX_DOCUMENT_WARNING_DAYS,
  MIN_DOCUMENT_WARNING_DAYS,
} from '@school-bus-tracking/validation';
import { MAX_DOCUMENT_REQUIREMENTS } from '../documents.constants';

/** One requirement a school may override for a document type. */
export class DocumentRequirementItemDto implements DocumentRequirementInput {
  @IsString({ message: 'document_type must be a string' })
  @IsNotEmpty({ message: 'document_type is required' })
  @MaxLength(64, { message: 'document_type must be at most 64 characters' })
  document_type!: string;

  @Type(() => Boolean)
  @IsBoolean({ message: 'is_required must be a boolean' })
  is_required!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'expiry_warning_days must be an integer' })
  @Min(MIN_DOCUMENT_WARNING_DAYS, {
    message: `expiry_warning_days must be at least ${MIN_DOCUMENT_WARNING_DAYS}`,
  })
  @Max(MAX_DOCUMENT_WARNING_DAYS, {
    message: `expiry_warning_days must be at most ${MAX_DOCUMENT_WARNING_DAYS}`,
  })
  declare expiry_warning_days?: number | null;
}

/**
 * Body of `PUT /api/v1/document-requirements`.
 *
 * `owner_type` selects the catalogue (`BUS` or `DRIVER`) the items are
 * validated against; the service rejects any `document_type` that is not part
 * of it. There is no `school_id` — the tenant comes from the JWT, so one
 * school can never reconfigure another.
 */
export class UpdateDocumentRequirementsDto implements DocumentRequirementsUpdateRequest {
  @IsEnum(DOCUMENT_OWNER_TYPE_VALUES, {
    message: 'owner_type must be BUS or DRIVER',
  })
  owner_type!: DocumentOwnerType;

  @IsArray({ message: 'items must be an array' })
  @ArrayMinSize(1, { message: 'items must contain at least one requirement' })
  @ArrayMaxSize(MAX_DOCUMENT_REQUIREMENTS, {
    message: `items must contain at most ${MAX_DOCUMENT_REQUIREMENTS} requirements`,
  })
  @ValidateNested({ each: true })
  @Type(() => DocumentRequirementItemDto)
  items!: DocumentRequirementItemDto[];
}
