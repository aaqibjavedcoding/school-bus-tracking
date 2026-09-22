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
import type { DocumentOwnerType } from '@school-bus-tracking/shared-types';
import {
  MAX_DOCUMENT_WARNING_DAYS,
  MIN_DOCUMENT_WARNING_DAYS,
} from '@school-bus-tracking/validation';
import { MAX_DOCUMENT_REQUIREMENTS } from '../documents.constants';

/** One requirement a school may override for a document type. */
export class DocumentRequirementItemDto implements DocumentRequirementInput {
  @IsString({ message: 'Please enter a valid document type.' })
  @IsNotEmpty({ message: 'Please select the document type.' })
  @MaxLength(64, { message: 'Please enter at most 64 characters for the document type.' })
  document_type!: string;

  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the required flag.' })
  is_required!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the expiry warning window (in days).' })
  @Min(MIN_DOCUMENT_WARNING_DAYS, {
    message: `Please enter a value of at least ${MIN_DOCUMENT_WARNING_DAYS} for the expiry warning window (in days).`,
  })
  @Max(MAX_DOCUMENT_WARNING_DAYS, {
    message: `Please enter a value of at most ${MAX_DOCUMENT_WARNING_DAYS} for the expiry warning window (in days).`,
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
    message: 'Please select a valid document owner type (one of: BUS, DRIVER).',
  })
  owner_type!: DocumentOwnerType;

  @IsArray({ message: 'Please provide the document requirements as a list.' })
  @ArrayMinSize(1, { message: 'Please add at least one document requirement.' })
  @ArrayMaxSize(MAX_DOCUMENT_REQUIREMENTS, {
    message: `Please provide at most ${MAX_DOCUMENT_REQUIREMENTS} document requirements.`,
  })
  @ValidateNested({ each: true })
  @Type(() => DocumentRequirementItemDto)
  items!: DocumentRequirementItemDto[];
}
