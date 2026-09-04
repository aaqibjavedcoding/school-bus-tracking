import { BadRequestException } from '../../framework';
import {
  DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
  DocumentOwnerType,
  DocumentRequirement,
  DocumentRequirementsResponse,
} from '@school-bus-tracking/shared-types';
import {
  DocumentRequirement as DocumentRequirementModel,
  DocumentRequirementAttributes,
} from '../../database/models';
import {
  DOCUMENT_REQUIREMENTS_REPOSITORY,
  DOCUMENT_REQUIREMENT_TYPE_INVALID_MESSAGE,
} from './documents.constants';
import { isDocumentTypeValid, documentCatalogue } from './document-catalogue';
import { UpdateDocumentRequirementsDto } from './dto';

/** One effective requirement after defaults and overrides have been merged. */
export interface ResolvedRequirement {
  document_type: string;
  label: string;
  is_required: boolean;
  expiry_warning_days: number;
}

/**
 * Per-school required / optional configuration of the compliance catalogue.
 *
 * A school stores a row only for a document type it has *changed*; every
 * other type silently falls back to the built-in default. That keeps
 * onboarding free of seeding while still letting an operator decide that, say,
 * a police verification is mandatory for their drivers and a training
 * certificate is not.
 *
 * Every read is pinned with `school_id`, so one tenant's configuration can
 * never be read or written by another.
 */
export class DocumentRequirementsService {
  constructor(
    private readonly requirements: typeof DocumentRequirementModel,
  ) {}

  /**
   * Effective configuration of one catalogue: every built-in type in
   * catalogue order, with the school's own override applied where one exists.
   */
  async resolve(schoolId: string, ownerType: DocumentOwnerType): Promise<ResolvedRequirement[]> {
    const rows = await this.findRows(schoolId, ownerType);
    const byType = new Map(rows.map((row) => [row.document_type, row]));

    return documentCatalogue(ownerType).map((entry) => {
      const override = byType.get(entry.document_type);
      return {
        document_type: entry.document_type,
        label: entry.label,
        is_required: override ? override.is_required : entry.is_required,
        expiry_warning_days: override?.expiry_warning_days ?? DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
      };
    });
  }

  /** Effective configuration as an API projection. */
  async list(
    schoolId: string,
    ownerType: DocumentOwnerType,
  ): Promise<DocumentRequirementsResponse> {
    const rows = await this.findRows(schoolId, ownerType);
    const customized = new Set(rows.map((row) => row.document_type));

    return {
      owner_type: ownerType,
      items: (await this.resolve(schoolId, ownerType)).map((entry): DocumentRequirement => ({
        owner_type: ownerType,
        document_type: entry.document_type,
        document_type_label: entry.label,
        is_required: entry.is_required,
        expiry_warning_days: entry.expiry_warning_days,
        is_customized: customized.has(entry.document_type),
      })),
    };
  }

  /**
   * Replaces the school's overrides for the given document types.
   *
   * Types that are not mentioned keep whatever they had (an override stays an
   * override, a default stays a default), so a partial save from one screen
   * never silently resets another.
   */
  async update(
    schoolId: string,
    ownerType: DocumentOwnerType,
    dto: UpdateDocumentRequirementsDto,
  ): Promise<DocumentRequirementsResponse> {
    const invalid = dto.items.find((item) => !isDocumentTypeValid(ownerType, item.document_type));
    if (invalid) {
      throw new BadRequestException(DOCUMENT_REQUIREMENT_TYPE_INVALID_MESSAGE);
    }

    // Duplicate entries would make the result order-dependent; reject them.
    const seen = new Set<string>();
    for (const item of dto.items) {
      if (seen.has(item.document_type)) {
        throw new BadRequestException(DOCUMENT_REQUIREMENT_TYPE_INVALID_MESSAGE);
      }
      seen.add(item.document_type);
    }

    for (const item of dto.items) {
      const values: Partial<DocumentRequirementAttributes> = {
        is_required: item.is_required,
        expiry_warning_days: item.expiry_warning_days ?? DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
      };
      const [row] = await this.requirements.findOrCreate({
        where: {
          school_id: schoolId,
          owner_type: ownerType,
          document_type: item.document_type,
        },
        defaults: {
          school_id: schoolId,
          owner_type: ownerType,
          document_type: item.document_type,
          ...values,
        },
      });
      await row.update(values);
    }

    return this.list(schoolId, ownerType);
  }
  private async findRows(schoolId: string, ownerType: DocumentOwnerType) {
    return this.requirements.findAll({
      where: { school_id: schoolId, owner_type: ownerType },
    });
  }
}
