import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusDocumentCreateRequest,
  BusDocumentListResponse,
  BusDocumentResponse,
  BusDocumentUpdateRequest,
  DocumentDeleteResponse,
  DocumentStatus,
  DriverDocumentCreateRequest,
  DriverDocumentListResponse,
  DriverDocumentResponse,
  DriverDocumentUpdateRequest,
  PaginationMeta,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  Bus,
  BusDocument,
  BusDocumentAttributes,
  DriverDocument,
  DriverDocumentAttributes,
  User,
} from '../../database/models';
import {
  BUS_DOCUMENTS_REPOSITORY,
  BUS_DOCUMENT_DELETED_MESSAGE,
  BUS_DOCUMENT_NOT_FOUND_MESSAGE,
  DOCUMENTS_BUS_NOT_FOUND_MESSAGE,
  DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE,
  DOCUMENTS_BUS_REPOSITORY,
  DOCUMENTS_USER_REPOSITORY,
  DOCUMENT_DATE_RANGE_MESSAGE,
  DOCUMENT_TYPE_INVALID_MESSAGE,
  DRIVER_DOCUMENTS_REPOSITORY,
  DRIVER_DOCUMENT_DELETED_MESSAGE,
  DRIVER_DOCUMENT_NOT_FOUND_MESSAGE,
} from './documents.constants';
import { DocumentRequirementsService, ResolvedRequirement } from './document-requirements.service';
import { documentTypeLabel, isDocumentTypeValid } from './document-catalogue';
import {
  CreateBusDocumentDto,
  CreateDriverDocumentDto,
  ListDocumentsQueryDto,
  UpdateBusDocumentDto,
  UpdateDriverDocumentDto,
} from './dto';
import { deriveDocumentStatus, documentDaysRemaining } from '@school-bus-tracking/validation';

/** Fields shared by the two document tables, as the service writes them. */
interface DocumentValues {
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  file_name: string | null;
  file_url: string | null;
}

/**
 * School-admin CRUD for the compliance documents of a bus or a driver.
 *
 * Every method takes `schoolId` from the verified JWT (never from the request)
 * and pins each query with it, so a cross-tenant probe sees exactly the same
 * generic `404` as a missing record.
 *
 * **Validity is never stored or accepted.** A document carries only its real
 * `issue_date` / `expiry_date`; the `VALID` / `EXPIRING_SOON` / `EXPIRED`
 * status returned to clients is computed from those dates on every read by
 * the shared `deriveDocumentStatus`, which the web console and the mobile app
 * call too. A client therefore cannot mark an expired certificate as valid.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(BUS_DOCUMENTS_REPOSITORY) private readonly busDocuments: typeof BusDocument,
    @Inject(DRIVER_DOCUMENTS_REPOSITORY)
    private readonly driverDocuments: typeof DriverDocument,
    @Inject(DOCUMENTS_BUS_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(DOCUMENTS_USER_REPOSITORY) private readonly users: typeof User,
    private readonly requirements: DocumentRequirementsService,
  ) {}

  // ---------------------------------------------------------------- buses --

  /** Validates that the bus exists inside the authenticated school. */
  async assertBus(schoolId: string, busId: string): Promise<Bus> {
    const bus = await this.buses.findOne({ where: { id: busId, school_id: schoolId } });
    if (!bus) {
      throw new NotFoundException(DOCUMENTS_BUS_NOT_FOUND_MESSAGE);
    }
    return bus;
  }

  /**
   * Paginated documents of one bus.
   *
   * The rows are loaded without a SQL limit first because `status` is derived
   * per row — a fleet vehicle holds a handful of documents, so filtering and
   * paginating in memory keeps the derived filter exact instead of lying about
   * totals.
   */
  async listBusDocuments(
    schoolId: string,
    busId: string,
    query: ListDocumentsQueryDto,
  ): Promise<BusDocumentListResponse> {
    await this.assertBus(schoolId, busId);
    const requirements = await this.requirements.resolve(schoolId, 'BUS');
    const rows = await this.busDocuments.findAll({
      where: { school_id: schoolId, bus_id: busId },
      order: [
        ['document_type', 'ASC'],
        ['expiry_date', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });

    const projected = rows.map((row) => this.toBusDocumentResponse(row, requirements));
    return paginate(projected, query, (item, status) => {
      if (status && item.status !== status) return false;
      return true;
    });
  }

  /** Adds a compliance document to a bus of the authenticated school. */
  async createBusDocument(
    schoolId: string,
    busId: string,
    dto: CreateBusDocumentDto | BusDocumentCreateRequest,
  ): Promise<BusDocumentResponse> {
    await this.assertBus(schoolId, busId);
    this.assertType('BUS', dto.document_type);
    const values = this.toValues(dto);

    const created = await this.busDocuments.create({
      school_id: schoolId,
      bus_id: busId,
      document_type: dto.document_type,
      ...values,
    });
    return this.toBusDocumentResponse(created, await this.requirements.resolve(schoolId, 'BUS'));
  }

  /**
   * One document of one bus. Ownership is checked with the JWT tenant, the
   * route bus id and the document id together.
   */
  async findOneBusDocument(
    schoolId: string,
    busId: string,
    id: string,
  ): Promise<BusDocumentResponse> {
    const row = await this.findBusDocument(schoolId, busId, id);
    return this.toBusDocumentResponse(row, await this.requirements.resolve(schoolId, 'BUS'));
  }

  /** Partial update; explicit `null` clears a nullable field. */
  async updateBusDocument(
    schoolId: string,
    busId: string,
    id: string,
    dto: UpdateBusDocumentDto | BusDocumentUpdateRequest,
  ): Promise<BusDocumentResponse> {
    const row = await this.findBusDocument(schoolId, busId, id);
    const updates: Partial<BusDocumentAttributes> = {};
    if (dto.document_type !== undefined) {
      this.assertType('BUS', dto.document_type);
      updates.document_type = dto.document_type;
    }
    Object.assign(updates, this.toValues(dto, row));

    await row.update(updates);
    return this.toBusDocumentResponse(row, await this.requirements.resolve(schoolId, 'BUS'));
  }

  /** Soft deletes (paranoid model) a bus document. */
  async removeBusDocument(
    schoolId: string,
    busId: string,
    id: string,
  ): Promise<DocumentDeleteResponse> {
    const row = await this.findBusDocument(schoolId, busId, id);
    await row.destroy();
    return { id, message: BUS_DOCUMENT_DELETED_MESSAGE };
  }

  // -------------------------------------------------------------- drivers --

  /** Validates that the driver exists inside the authenticated school. */
  async assertDriver(schoolId: string, driverId: string): Promise<User> {
    const driver = await this.users.findOne({
      where: { id: driverId, school_id: schoolId, role: UserRole.DRIVER },
    });
    if (!driver) {
      throw new NotFoundException(DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE);
    }
    return driver;
  }

  /** Paginated documents of one driver. */
  async listDriverDocuments(
    schoolId: string,
    driverId: string,
    query: ListDocumentsQueryDto,
  ): Promise<DriverDocumentListResponse> {
    await this.assertDriver(schoolId, driverId);
    const requirements = await this.requirements.resolve(schoolId, 'DRIVER');
    const rows = await this.driverDocuments.findAll({
      where: { school_id: schoolId, driver_id: driverId },
      order: [
        ['document_type', 'ASC'],
        ['expiry_date', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });

    const projected = rows.map((row) => this.toDriverDocumentResponse(row, requirements));
    return paginate(projected, query, (item, status) => (status ? item.status === status : true));
  }

  /** Adds a compliance document (licence, medical, …) to a driver. */
  async createDriverDocument(
    schoolId: string,
    driverId: string,
    dto: CreateDriverDocumentDto | DriverDocumentCreateRequest,
  ): Promise<DriverDocumentResponse> {
    await this.assertDriver(schoolId, driverId);
    this.assertType('DRIVER', dto.document_type);
    const values = this.toValues(dto);

    const created = await this.driverDocuments.create({
      school_id: schoolId,
      driver_id: driverId,
      document_type: dto.document_type,
      ...values,
    });
    return this.toDriverDocumentResponse(
      created,
      await this.requirements.resolve(schoolId, 'DRIVER'),
    );
  }

  /** One document of one driver. */
  async findOneDriverDocument(
    schoolId: string,
    driverId: string,
    id: string,
  ): Promise<DriverDocumentResponse> {
    const row = await this.findDriverDocument(schoolId, driverId, id);
    return this.toDriverDocumentResponse(row, await this.requirements.resolve(schoolId, 'DRIVER'));
  }

  /** Partial update of a driver document. */
  async updateDriverDocument(
    schoolId: string,
    driverId: string,
    id: string,
    dto: UpdateDriverDocumentDto | DriverDocumentUpdateRequest,
  ): Promise<DriverDocumentResponse> {
    const row = await this.findDriverDocument(schoolId, driverId, id);
    const updates: Partial<DriverDocumentAttributes> = {};
    if (dto.document_type !== undefined) {
      this.assertType('DRIVER', dto.document_type);
      updates.document_type = dto.document_type;
    }
    Object.assign(updates, this.toValues(dto, row));

    await row.update(updates);
    return this.toDriverDocumentResponse(row, await this.requirements.resolve(schoolId, 'DRIVER'));
  }

  /** Soft deletes a driver document. */
  async removeDriverDocument(
    schoolId: string,
    driverId: string,
    id: string,
  ): Promise<DocumentDeleteResponse> {
    const row = await this.findDriverDocument(schoolId, driverId, id);
    await row.destroy();
    return { id, message: DRIVER_DOCUMENT_DELETED_MESSAGE };
  }

  // --------------------------------------------------------------- helpers --

  private async findBusDocument(schoolId: string, busId: string, id: string): Promise<BusDocument> {
    const row = await this.busDocuments.findOne({
      where: { id, school_id: schoolId, bus_id: busId },
    });
    if (!row) {
      throw new NotFoundException(BUS_DOCUMENT_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  private async findDriverDocument(
    schoolId: string,
    driverId: string,
    id: string,
  ): Promise<DriverDocument> {
    const row = await this.driverDocuments.findOne({
      where: { id, school_id: schoolId, driver_id: driverId },
    });
    if (!row) {
      throw new NotFoundException(DRIVER_DOCUMENT_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /** Rejects a document type that does not belong to the owner's catalogue. */
  private assertType(ownerType: 'BUS' | 'DRIVER', documentType: string): void {
    if (!isDocumentTypeValid(ownerType, documentType)) {
      throw new BadRequestException(DOCUMENT_TYPE_INVALID_MESSAGE);
    }
  }

  /**
   * Normalizes the shared document fields of a create/update payload.
   *
   * `current` is supplied on update so a partial payload can be range-checked
   * against the values already stored (moving only `expiry_date` must still
   * honour the stored `issue_date`).
   */
  private toValues(
    dto: Partial<DocumentValues> & { document_type?: string },
    current?: DocumentValues,
  ): DocumentValues {
    // On update a field that is absent keeps its stored value; only an
    // explicit `null` clears it. On create there is nothing to keep, so every
    // unsupplied field is `null`.
    const issueDate = dto.issue_date !== undefined ? dto.issue_date : (current?.issue_date ?? null);
    const expiryDate =
      dto.expiry_date !== undefined ? dto.expiry_date : (current?.expiry_date ?? null);

    if (issueDate && expiryDate && new Date(expiryDate) < new Date(issueDate)) {
      throw new BadRequestException(DOCUMENT_DATE_RANGE_MESSAGE);
    }

    return {
      document_number: pick(dto.document_number, current?.document_number),
      issue_date: issueDate,
      expiry_date: expiryDate,
      notes: pick(dto.notes, current?.notes),
      file_name: pick(dto.file_name, current?.file_name),
      file_url: pick(dto.file_url, current?.file_url),
    };
  }

  private toBusDocumentResponse(
    row: BusDocument,
    requirements: ResolvedRequirement[],
  ): BusDocumentResponse {
    const requirement = requirements.find((item) => item.document_type === row.document_type);
    const daysRemaining = documentDaysRemaining(row.expiry_date);
    return {
      id: row.id,
      school_id: row.school_id,
      bus_id: row.bus_id,
      document_type: row.document_type,
      document_type_label: documentTypeLabel('BUS', row.document_type),
      document_number: row.document_number,
      issue_date: row.issue_date,
      expiry_date: row.expiry_date,
      notes: row.notes,
      file_name: row.file_name,
      file_url: row.file_url,
      status: deriveDocumentStatus(row.expiry_date, {
        warningDays: requirement?.expiry_warning_days,
      }),
      days_remaining: daysRemaining,
      is_required: requirement?.is_required ?? false,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  private toDriverDocumentResponse(
    row: DriverDocument,
    requirements: ResolvedRequirement[],
  ): DriverDocumentResponse {
    const requirement = requirements.find((item) => item.document_type === row.document_type);
    const daysRemaining = documentDaysRemaining(row.expiry_date);
    return {
      id: row.id,
      school_id: row.school_id,
      driver_id: row.driver_id,
      document_type: row.document_type,
      document_type_label: documentTypeLabel('DRIVER', row.document_type),
      document_number: row.document_number,
      issue_date: row.issue_date,
      expiry_date: row.expiry_date,
      notes: row.notes,
      file_name: row.file_name,
      file_url: row.file_url,
      status: deriveDocumentStatus(row.expiry_date, {
        warningDays: requirement?.expiry_warning_days,
      }),
      days_remaining: daysRemaining,
      is_required: requirement?.is_required ?? false,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }
}

/**
 * Keeps the stored value when a partial update does not mention the field;
 * `null` clears it explicitly.
 */
function pick(
  value: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (value !== undefined) {
    return value;
  }
  return fallback ?? null;
}

/** ISO-8601 string of a `Date`, tolerant of a driver-supplied string. */
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * In-memory pagination over an already-projected list.
 *
 * Document sets are small (a handful of rows per vehicle or crew member) and
 * the `status` filter is derived rather than stored, so slicing here keeps the
 * reported totals exact.
 */
function paginate<T extends { document_type: string; status: DocumentStatus }>(
  items: T[],
  query: ListDocumentsQueryDto,
  matches: (item: T, status: DocumentStatus | undefined) => boolean,
): { items: T[]; meta: PaginationMeta } {
  const filtered = items.filter(
    (item) =>
      (!query.document_type || item.document_type === query.document_type) &&
      matches(item, query.status),
  );

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const totalPages = Math.ceil(filtered.length / limit);
  return {
    items: filtered.slice((page - 1) * limit, (page - 1) * limit + limit),
    meta: {
      page,
      limit,
      total: filtered.length,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
