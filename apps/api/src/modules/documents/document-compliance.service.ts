import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DocumentComplianceResponse,
  DocumentComplianceSummary,
  DocumentOverviewItem,
  DocumentOverviewResponse,
  DocumentOwnerType,
  DocumentRequirementStatus,
  PaginationMeta,
} from '@school-bus-tracking/shared-types';
import { deriveDocumentStatus, documentDaysRemaining } from '@school-bus-tracking/validation';
import { Op } from 'sequelize';
import { Bus, BusDocument, DriverDocument, User } from '../../database/models';
import {
  BUS_DOCUMENTS_REPOSITORY,
  DOCUMENTS_BUS_NOT_FOUND_MESSAGE,
  DOCUMENTS_BUS_REPOSITORY,
  DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE,
  DOCUMENT_CREW_ROLES,
  DOCUMENTS_USER_REPOSITORY,
  DRIVER_DOCUMENTS_REPOSITORY,
} from './documents.constants';
import { DocumentRequirementsService, ResolvedRequirement } from './document-requirements.service';
import { DocumentOverviewQueryDto } from './dto';

/** Minimal shape the engine needs from a stored document. */
interface ComplianceDocumentRow {
  id: string;
  owner_id: string;
  document_type: string;
  expiry_date: string | null;
  created_at: Date | string;
}

/** One owner (bus or driver) with the rows attached to it. */
interface ComplianceOwner {
  owner_type: DocumentOwnerType;
  owner_id: string;
  owner_label: string;
  documents: ComplianceDocumentRow[];
}

/**
 * The document requirement / expiry engine (Task 44).
 *
 * It answers one question for a resource — "is this bus (or driver) allowed to
 * run?" — by combining two inputs:
 *
 * 1. **What the school requires** (`DocumentRequirementsService`): which
 *    document types are mandatory and how much warning the school wants.
 * 2. **What is actually on file** (the newest document of each type).
 *
 * and producing four derivable states per requirement:
 *
 * - `MISSING`       → required, but no document of that type exists
 * - `EXPIRED`       → the newest document's expiry date is in the past
 * - `EXPIRING_SOON` → it expires within the configured warning window
 * - `VALID`         → it is current (or has no expiry date at all)
 *
 * Nothing here reads or writes a stored status: every state comes from a real
 * date, so fake validity is structurally impossible.
 *
 * Every query is pinned with `school_id`, so one tenant can never appear in
 * another tenant's compliance report.
 */
@Injectable()
export class DocumentComplianceService {
  constructor(
    @Inject(BUS_DOCUMENTS_REPOSITORY) private readonly busDocuments: typeof BusDocument,
    @Inject(DRIVER_DOCUMENTS_REPOSITORY)
    private readonly driverDocuments: typeof DriverDocument,
    @Inject(DOCUMENTS_BUS_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(DOCUMENTS_USER_REPOSITORY) private readonly users: typeof User,
    private readonly requirements: DocumentRequirementsService,
  ) {}

  /** Compliance of one bus of the authenticated school. */
  async getBusCompliance(schoolId: string, busId: string): Promise<DocumentComplianceResponse> {
    const bus = await this.buses.findOne({ where: { id: busId, school_id: schoolId } });
    if (!bus) {
      throw new NotFoundException(DOCUMENTS_BUS_NOT_FOUND_MESSAGE);
    }
    const [requirements, rows] = await Promise.all([
      this.requirements.resolve(schoolId, 'BUS'),
      this.busDocuments.findAll({ where: { school_id: schoolId, bus_id: busId } }),
    ]);

    return this.buildCompliance(
      {
        owner_type: 'BUS',
        owner_id: bus.id,
        owner_label: bus.registration_number,
        documents: rows.map((row) => ({
          id: row.id,
          owner_id: row.bus_id,
          document_type: row.document_type,
          expiry_date: row.expiry_date,
          created_at: row.created_at,
        })),
      },
      requirements,
    );
  }

  /** Compliance of one driver of the authenticated school. */
  async getDriverCompliance(
    schoolId: string,
    driverId: string,
  ): Promise<DocumentComplianceResponse> {
    const driver = await this.users.findOne({
      where: { id: driverId, school_id: schoolId, role: { [Op.in]: [...DOCUMENT_CREW_ROLES] } },
    });
    if (!driver) {
      throw new NotFoundException(DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE);
    }
    const [requirements, rows] = await Promise.all([
      this.requirements.resolve(schoolId, 'DRIVER'),
      this.driverDocuments.findAll({ where: { school_id: schoolId, driver_id: driverId } }),
    ]);

    return this.buildCompliance(
      {
        owner_type: 'DRIVER',
        owner_id: driver.id,
        owner_label: `${driver.first_name} ${driver.last_name}`.trim(),
        documents: rows.map((row) => ({
          id: row.id,
          owner_id: row.driver_id,
          document_type: row.document_type,
          expiry_date: row.expiry_date,
          created_at: row.created_at,
        })),
      },
      requirements,
    );
  }

  /**
   * School-wide compliance overview: every bus and every driver with the
   * requirement entries that need attention.
   *
   * The whole fleet is evaluated in memory (a handful of batched queries) so
   * the `compliance` filter and the aggregate summary cannot disagree with
   * the per-owner rows the UI renders.
   */
  async getOverview(
    schoolId: string,
    query: DocumentOverviewQueryDto,
  ): Promise<DocumentOverviewResponse> {
    const owners = await this.collectOwners(schoolId);
    const [busRequirements, driverRequirements] = await Promise.all([
      this.requirements.resolve(schoolId, 'BUS'),
      this.requirements.resolve(schoolId, 'DRIVER'),
    ]);

    const evaluated = owners.map((owner) =>
      this.buildCompliance(
        owner,
        owner.owner_type === 'BUS' ? busRequirements : driverRequirements,
      ),
    );

    const search = query.search?.trim().toLowerCase();
    const filtered = evaluated.filter((entry) => {
      if (query.owner_type && entry.owner_type !== query.owner_type) {
        return false;
      }
      if (query.compliance === 'attention' && !needsAttention(entry)) {
        return false;
      }
      if (query.compliance === 'compliant' && needsAttention(entry)) {
        return false;
      }
      if (search && !entry.owner_label.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const totalPages = Math.ceil(filtered.length / limit);
    const meta: PaginationMeta = {
      page,
      limit,
      total: filtered.length,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return {
      summary: aggregateSummary(evaluated),
      items: filtered
        .slice((page - 1) * limit, (page - 1) * limit + limit)
        .map((entry): DocumentOverviewItem => ({
          owner_type: entry.owner_type,
          owner_id: entry.owner_id,
          owner_label: entry.owner_label,
          summary: entry.summary,
          // Only the findings: an owner with nothing to fix carries no issues.
          issues: entry.requirements.filter((item) => item.state !== 'VALID'),
        })),
      meta,
    };
  }

  // --------------------------------------------------------------- engine --

  /**
   * Evaluates one owner against its requirement catalogue.
   *
   * Only *required* types and optional types that actually have a document are
   * reported: an optional document type nobody has filed is not a finding, so
   * it would only add noise to the compliance screen.
   */
  private buildCompliance(
    owner: ComplianceOwner,
    requirements: ResolvedRequirement[],
  ): DocumentComplianceResponse & { documents: ComplianceDocumentRow[] } {
    const statuses = requirements.map((requirement) => {
      const document = this.newestDocument(owner.documents, requirement.document_type);
      return this.toRequirementStatus(owner.owner_type, requirement, document);
    });

    const reported = statuses.filter((status) => status.is_required || status.document_id !== null);
    const summary = summarize(reported);

    return {
      owner_type: owner.owner_type,
      owner_id: owner.owner_id,
      owner_label: owner.owner_label,
      summary,
      requirements: reported,
      documents: owner.documents,
    };
  }

  /**
   * The current document of one type: the one that lasts longest, so a
   * superseded policy filed after its replacement never wins. An undated
   * document (no expiry) always wins because it never expires; ties are broken
   * by creation time.
   */
  private newestDocument(
    documents: ComplianceDocumentRow[],
    documentType: string,
  ): ComplianceDocumentRow | null {
    const candidates = documents.filter((row) => row.document_type === documentType);
    if (candidates.length === 0) {
      return null;
    }
    const rank = (row: ComplianceDocumentRow): number =>
      row.expiry_date ? new Date(row.expiry_date).getTime() : Number.POSITIVE_INFINITY;

    return [...candidates].sort((a, b) => {
      const diff = rank(b) - rank(a);
      if (diff !== 0 && Number.isFinite(diff)) {
        return diff;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })[0];
  }

  private toRequirementStatus(
    ownerType: DocumentOwnerType,
    requirement: ResolvedRequirement,
    document: ComplianceDocumentRow | null,
  ): DocumentRequirementStatus {
    const label = requirement.label;
    if (!document) {
      return {
        owner_type: ownerType,
        document_type: requirement.document_type,
        document_type_label: label,
        is_required: requirement.is_required,
        state: 'MISSING',
        document_id: null,
        expiry_date: null,
        days_remaining: null,
      };
    }

    const status = deriveDocumentStatus(document.expiry_date, {
      warningDays: requirement.expiry_warning_days,
    });
    return {
      owner_type: ownerType,
      document_type: requirement.document_type,
      document_type_label: label,
      is_required: requirement.is_required,
      state: status,
      document_id: document.id,
      expiry_date: document.expiry_date,
      days_remaining: documentDaysRemaining(document.expiry_date),
    };
  }

  /** Loads every bus and driver of the school with their documents attached. */
  private async collectOwners(schoolId: string): Promise<ComplianceOwner[]> {
    const [buses, drivers, busDocuments, driverDocuments] = await Promise.all([
      this.buses.findAll({ where: { school_id: schoolId } }),
      this.users.findAll({
        where: { school_id: schoolId, role: { [Op.in]: [...DOCUMENT_CREW_ROLES] } },
        order: [
          ['first_name', 'ASC'],
          ['last_name', 'ASC'],
        ],
      }),
      this.busDocuments.findAll({ where: { school_id: schoolId } }),
      this.driverDocuments.findAll({ where: { school_id: schoolId } }),
    ]);

    const busOwners: ComplianceOwner[] = buses.map((bus) => ({
      owner_type: 'BUS' as DocumentOwnerType,
      owner_id: bus.id,
      owner_label: bus.registration_number,
      documents: busDocuments
        .filter((row) => row.bus_id === bus.id)
        .map((row) => ({
          id: row.id,
          owner_id: row.bus_id,
          document_type: row.document_type,
          expiry_date: row.expiry_date,
          created_at: row.created_at,
        })),
    }));

    const driverOwners: ComplianceOwner[] = drivers.map((driver) => ({
      owner_type: 'DRIVER' as DocumentOwnerType,
      owner_id: driver.id,
      owner_label: `${driver.first_name} ${driver.last_name}`.trim(),
      documents: driverDocuments
        .filter((row) => row.driver_id === driver.id)
        .map((row) => ({
          id: row.id,
          owner_id: row.driver_id,
          document_type: row.document_type,
          expiry_date: row.expiry_date,
          created_at: row.created_at,
        })),
    }));

    return [...busOwners, ...driverOwners];
  }
}

/** True when the owner has anything missing, expired or expiring soon. */
function needsAttention(entry: { summary: DocumentComplianceSummary }): boolean {
  return !entry.summary.is_compliant || entry.summary.expiring_soon > 0;
}

/**
 * Rolls requirement statuses up into the counters the UI renders.
 *
 * Counts are taken over **required** types only: an optional document that is
 * missing is not a compliance finding. `is_compliant` means nothing required
 * is missing or expired — "expiring soon" is a warning that keeps the resource
 * compliant today.
 */
function summarize(statuses: DocumentRequirementStatus[]): DocumentComplianceSummary {
  const required = statuses.filter((status) => status.is_required);
  const valid = required.filter((status) => status.state === 'VALID').length;
  const expiringSoon = required.filter((status) => status.state === 'EXPIRING_SOON').length;
  const expired = required.filter((status) => status.state === 'EXPIRED').length;
  const missing = required.filter((status) => status.state === 'MISSING').length;

  return {
    required_total: required.length,
    valid,
    expiring_soon: expiringSoon,
    expired,
    missing,
    is_compliant: missing === 0 && expired === 0,
  };
}

/** School-wide aggregate over every evaluated owner. */
function aggregateSummary(
  entries: Array<{ summary: DocumentComplianceSummary }>,
): DocumentComplianceSummary {
  const totals = entries.reduce(
    (acc, entry) => ({
      required_total: acc.required_total + entry.summary.required_total,
      valid: acc.valid + entry.summary.valid,
      expiring_soon: acc.expiring_soon + entry.summary.expiring_soon,
      expired: acc.expired + entry.summary.expired,
      missing: acc.missing + entry.summary.missing,
    }),
    { required_total: 0, valid: 0, expiring_soon: 0, expired: 0, missing: 0 },
  );

  return {
    ...totals,
    is_compliant: totals.missing === 0 && totals.expired === 0,
  };
}
