import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '../../framework';
import {
  BusDocumentType,
  DocumentStatus,
  DriverDocumentType,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { DocumentsService } from './documents.service';
import { DocumentRequirementsService } from './document-requirements.service';
import {
  BUS_DOCUMENT_DELETED_MESSAGE,
  BUS_DOCUMENT_NOT_FOUND_MESSAGE,
  DOCUMENTS_BUS_NOT_FOUND_MESSAGE,
  DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE,
  DOCUMENT_DATE_RANGE_MESSAGE,
  DOCUMENT_TYPE_INVALID_MESSAGE,
  DRIVER_DOCUMENT_DELETED_MESSAGE,
  DRIVER_DOCUMENT_NOT_FOUND_MESSAGE,
} from './documents.constants';
import { CreateBusDocumentDto } from './dto/create-bus-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UpdateBusDocumentDto } from './dto/update-bus-document.dto';
import { CreateDriverDocumentDto } from './dto/create-driver-document.dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const BUS_B = '06060606-0606-4606-8606-060606060602';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';

/**
 * Dates are built relative to the real clock so the suite never depends on a
 * hard-coded calendar day: the service derives validity from `new Date()`, and
 * these helpers keep the fixtures on the right side of the boundaries.
 */
function dateInDays(days: number): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

interface StubRecord {
  id: string;
  school_id: string;
  [key: string]: unknown;
}

/** Shape of a bus/driver document row as the service seeds and reads it. */
interface DocumentRow extends StubRecord {
  document_type: string;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  file_name: string | null;
  file_url: string | null;
}

/** Shape of a `document_requirements` override row. */
interface RequirementRow extends StubRecord {
  owner_type: string;
  document_type: string;
  is_required: boolean;
  expiry_warning_days: number;
}

/** Shape of the bus and user rows the service looks owners up against. */
interface BusRow extends StubRecord {
  registration_number: string;
}

interface UserRow extends StubRecord {
  role: UserRole;
  first_name: string;
  last_name: string;
}

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${(sequence += 1)}`;

/**
 * Minimal in-memory repository: enough of the Sequelize surface the service
 * uses (`findOne` / `findAll` / `create` + instance `update` / `destroy`),
 * including the paranoid soft-delete behaviour the service depends on.
 */
function makeRepository<T extends StubRecord>(prefix: string) {
  const rows: T[] = [];

  const matches = (row: T, where: Record<string, unknown>): boolean => {
    if (row.deleted_at) {
      return false;
    }
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const operators = value as Record<string | symbol, unknown>;
        // Sequelize operators are symbols (`Op.in`), so both string keys and
        // symbol keys have to be inspected here.
        const entries: [string, unknown][] = [
          ...Object.entries(operators),
          ...Object.getOwnPropertySymbols(operators).map((symbol): [string, unknown] => [
            (symbol.description ?? '').replace(/^Symbol\(|\)$/g, ''),
            operators[symbol],
          ]),
        ];
        return entries.every(([op, operand]) => {
          if (op === 'in') {
            return (operand as unknown[]).includes(row[key]);
          }
          if (op === 'ne') {
            return row[key] !== operand;
          }
          return row[key] === operand;
        });
      }
      return row[key] === value;
    });
  };

  const decorate = (row: T): T => {
    const record = row as T & {
      update: unknown;
      destroy: unknown;
      deleted_at: Date | null;
    };
    record.update = async (values: Partial<T>) => {
      Object.assign(record, values);
      return record;
    };
    record.destroy = async () => {
      record.deleted_at = new Date();
    };
    return row;
  };

  return {
    rows,
    repo: {
      create: async (values: Partial<T>) => {
        const row = decorate({
          id: nextId(prefix),
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          updated_at: new Date('2026-01-01T00:00:00.000Z'),
          deleted_at: null,
          ...values,
        } as unknown as T);
        rows.push(row);
        return row;
      },
      findOne: async (options: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, options.where)) ?? null,
      findAll: async (options: { where?: Record<string, unknown> } = {}) =>
        rows.filter((row) => (options.where ? matches(row, options.where) : true)),
    },
  };
}

function makeService() {
  const busDocuments = makeRepository<DocumentRow & { bus_id: string }>('bd');
  const driverDocuments = makeRepository<DocumentRow & { driver_id: string }>('dd');
  const requirements = makeRepository<RequirementRow>('req');
  const buses = makeRepository<BusRow>('bus');
  const users = makeRepository<UserRow>('user');

  buses.repo.create({ id: BUS_A, school_id: SCHOOL_A, registration_number: 'BUS-A-1' });
  buses.repo.create({ id: BUS_B, school_id: SCHOOL_B, registration_number: 'BUS-B-1' });
  users.repo.create({
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    first_name: 'Asha',
    last_name: 'Rane',
  });
  users.repo.create({
    id: 'conductor-a',
    school_id: SCHOOL_A,
    role: UserRole.CONDUCTOR,
    first_name: 'Cory',
    last_name: 'Duta',
  });

  const requirementsService = new DocumentRequirementsService(requirements.repo as never);
  const service = new DocumentsService(
    busDocuments.repo as never,
    driverDocuments.repo as never,
    buses.repo as never,
    users.repo as never,
    requirementsService,
  );

  return { service, busDocuments, driverDocuments, requirements, buses, users };
}

const busDocumentBody = (overrides: Partial<CreateBusDocumentDto> = {}): CreateBusDocumentDto =>
  ({
    document_type: BusDocumentType.INSURANCE,
    document_number: 'POL-1',
    issue_date: '2026-04-01',
    // Five days out — inside the default 30-day "expiring soon" window.
    expiry_date: dateInDays(5),
    notes: null,
    file_name: null,
    file_url: null,
    ...overrides,
  }) as CreateBusDocumentDto;

const listQuery = (overrides: Partial<ListDocumentsQueryDto> = {}): ListDocumentsQueryDto =>
  ({ page: 1, limit: 20, ...overrides }) as ListDocumentsQueryDto;

describe('DocumentsService — bus documents', () => {
  it('creates a document for a bus of the authenticated school', async () => {
    const { service } = makeService();
    const created = await service.createBusDocument(SCHOOL_A, BUS_A, busDocumentBody());

    assert.equal(created.school_id, SCHOOL_A);
    assert.equal(created.bus_id, BUS_A);
    assert.equal(created.document_type, BusDocumentType.INSURANCE);
    assert.equal(created.document_type_label, 'Insurance');
    // Validity is derived from the real date, never stored or asserted.
    assert.equal(created.status, DocumentStatus.EXPIRING_SOON);
    assert.equal(created.days_remaining, 5);
    assert.equal(created.is_required, true);
  });

  it('marks an undated document valid and an old one expired', async () => {
    const { service } = makeService();
    const undated = await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({
        document_type: BusDocumentType.REGISTRATION_CERTIFICATE,
        issue_date: null,
        expiry_date: null,
      }),
    );
    assert.equal(undated.status, DocumentStatus.VALID);
    assert.equal(undated.days_remaining, null);

    const expired = await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({
        document_type: BusDocumentType.POLLUTION_CERTIFICATE,
        issue_date: '2024-01-01',
        expiry_date: dateInDays(-30),
      }),
    );
    assert.equal(expired.status, DocumentStatus.EXPIRED);
    assert.equal(expired.days_remaining, -30);
  });

  it('refuses a bus of another tenant with the generic not-found message', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createBusDocument(SCHOOL_A, BUS_B, busDocumentBody()),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, DOCUMENTS_BUS_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('refuses a document type from the driver catalogue', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createBusDocument(
        SCHOOL_A,
        BUS_A,
        busDocumentBody({ document_type: 'DRIVING_LICENSE' as BusDocumentType }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.message, DOCUMENT_TYPE_INVALID_MESSAGE);
        return true;
      },
    );
  });

  it('rejects an expiry date before the issue date', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createBusDocument(
        SCHOOL_A,
        BUS_A,
        busDocumentBody({ issue_date: '2027-01-01', expiry_date: '2026-01-01' }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.message, DOCUMENT_DATE_RANGE_MESSAGE);
        return true;
      },
    );
  });

  it('lists documents with pagination and the derived status filter', async () => {
    const { service } = makeService();
    await service.createBusDocument(SCHOOL_A, BUS_A, busDocumentBody());
    await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({
        document_type: BusDocumentType.POLLUTION_CERTIFICATE,
        issue_date: '2024-01-01',
        expiry_date: dateInDays(-30),
      }),
    );
    await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({ document_type: BusDocumentType.PERMIT, expiry_date: dateInDays(400) }),
    );

    const all = await service.listBusDocuments(SCHOOL_A, BUS_A, listQuery());
    assert.equal(all.items.length, 3);
    assert.equal(all.meta.total, 3);

    const expired = await service.listBusDocuments(
      SCHOOL_A,
      BUS_A,
      listQuery({ status: DocumentStatus.EXPIRED }),
    );
    assert.equal(expired.meta.total, 1);
    assert.equal(expired.items[0].document_type, BusDocumentType.POLLUTION_CERTIFICATE);

    const valid = await service.listBusDocuments(
      SCHOOL_A,
      BUS_A,
      listQuery({ status: DocumentStatus.VALID }),
    );
    assert.equal(valid.meta.total, 1);
    assert.equal(valid.items[0].document_type, BusDocumentType.PERMIT);

    const firstPage = await service.listBusDocuments(SCHOOL_A, BUS_A, listQuery({ limit: 2 }));
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.meta.totalPages, 2);
    assert.equal(firstPage.meta.hasNextPage, true);
  });

  it('updates only the supplied fields and clears with null', async () => {
    const { service } = makeService();
    const created = await service.createBusDocument(SCHOOL_A, BUS_A, busDocumentBody());

    const updated = await service.updateBusDocument(SCHOOL_A, BUS_A, created.id, {
      document_number: 'POL-2',
      notes: 'Renewed early',
    } as UpdateBusDocumentDto);
    assert.equal(updated.document_number, 'POL-2');
    assert.equal(updated.notes, 'Renewed early');
    assert.equal(updated.expiry_date, dateInDays(5));

    const cleared = await service.updateBusDocument(SCHOOL_A, BUS_A, created.id, {
      notes: null,
      file_url: null,
    } as UpdateBusDocumentDto);
    assert.equal(cleared.notes, null);
    assert.equal(cleared.document_number, 'POL-2');
  });

  it('range-checks a partial update against the stored issue date', async () => {
    const { service } = makeService();
    const created = await service.createBusDocument(SCHOOL_A, BUS_A, busDocumentBody());
    await assert.rejects(
      service.updateBusDocument(SCHOOL_A, BUS_A, created.id, {
        expiry_date: '2020-01-01',
      } as UpdateBusDocumentDto),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.message, DOCUMENT_DATE_RANGE_MESSAGE);
        return true;
      },
    );
  });

  it('hides another tenant’s document behind the generic not-found message', async () => {
    const { service } = makeService();
    const created = await service.createBusDocument(SCHOOL_A, BUS_A, busDocumentBody());
    await assert.rejects(
      service.findOneBusDocument(SCHOOL_B, BUS_A, created.id),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, BUS_DOCUMENT_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('soft-deletes a document and reports the confirmation', async () => {
    const { service } = makeService();
    const created = await service.createBusDocument(SCHOOL_A, BUS_A, busDocumentBody());
    const result = await service.removeBusDocument(SCHOOL_A, BUS_A, created.id);
    assert.deepEqual(result, { id: created.id, message: BUS_DOCUMENT_DELETED_MESSAGE });

    const remaining = await service.listBusDocuments(SCHOOL_A, BUS_A, listQuery());
    assert.equal(remaining.items.length, 0);
  });
});

describe('DocumentsService — driver documents', () => {
  const driverBody = (overrides: Partial<CreateDriverDocumentDto> = {}): CreateDriverDocumentDto =>
    ({
      document_type: DriverDocumentType.DRIVING_LICENSE,
      document_number: 'DL-0420110012345',
      issue_date: '2019-05-01',
      expiry_date: '2029-04-30',
      notes: null,
      file_name: null,
      file_url: null,
      ...overrides,
    }) as CreateDriverDocumentDto;

  it('creates a driving licence with its licence number', async () => {
    const { service } = makeService();
    const created = await service.createDriverDocument(SCHOOL_A, DRIVER_A, driverBody());
    assert.equal(created.driver_id, DRIVER_A);
    assert.equal(created.document_number, 'DL-0420110012345');
    assert.equal(created.document_type_label, 'Driving licence');
    assert.equal(created.status, DocumentStatus.VALID);
    assert.equal(created.is_required, true);
  });

  it('reports an optional document as not required', async () => {
    const { service } = makeService();
    const created = await service.createDriverDocument(
      SCHOOL_A,
      DRIVER_A,
      driverBody({ document_type: DriverDocumentType.MEDICAL_CERTIFICATE }),
    );
    assert.equal(created.is_required, false);
  });

  it('attaches documents to a conductor as well as a driver', async () => {
    const { service } = makeService();
    const created = await service.createDriverDocument(SCHOOL_A, 'conductor-a', driverBody());
    assert.equal(created.driver_id, 'conductor-a');

    const listed = await service.listDriverDocuments(SCHOOL_A, 'conductor-a', listQuery());
    assert.equal(listed.items.length, 1);
  });

  it('refuses to attach documents to a member of another school', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createDriverDocument(SCHOOL_B, DRIVER_A, driverBody()),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, DOCUMENTS_DRIVER_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });

  it('rejects a bus document type on the driver resource', async () => {
    const { service } = makeService();
    await assert.rejects(
      service.createDriverDocument(
        SCHOOL_A,
        DRIVER_A,
        driverBody({ document_type: 'INSURANCE' as DriverDocumentType }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.message, DOCUMENT_TYPE_INVALID_MESSAGE);
        return true;
      },
    );
  });

  it('lists, updates and soft-deletes driver documents', async () => {
    const { service } = makeService();
    const created = await service.createDriverDocument(SCHOOL_A, DRIVER_A, driverBody());
    const list = await service.listDriverDocuments(SCHOOL_A, DRIVER_A, listQuery());
    assert.equal(list.items.length, 1);

    const updated = await service.updateDriverDocument(SCHOOL_A, DRIVER_A, created.id, {
      expiry_date: dateInDays(-1),
    });
    assert.equal(updated.status, DocumentStatus.EXPIRED);

    const result = await service.removeDriverDocument(SCHOOL_A, DRIVER_A, created.id);
    assert.equal(result.message, DRIVER_DOCUMENT_DELETED_MESSAGE);
    await assert.rejects(
      service.findOneDriverDocument(SCHOOL_A, DRIVER_A, created.id),
      (error: unknown) => {
        assert.equal((error as { message: string }).message, DRIVER_DOCUMENT_NOT_FOUND_MESSAGE);
        return true;
      },
    );
  });
});

describe('DocumentsService — required / optional configuration', () => {
  it('applies a school override to the reported requirement flag', async () => {
    const { service, requirements } = makeService();
    await requirements.repo.create({
      school_id: SCHOOL_A,
      owner_type: 'BUS',
      document_type: BusDocumentType.PERMIT,
      is_required: false,
      expiry_warning_days: 30,
    } as never);

    const created = await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({ document_type: BusDocumentType.PERMIT }),
    );
    assert.equal(created.is_required, false);
  });

  it('uses the configured warning window for the derived status', async () => {
    const { service, requirements } = makeService();
    await requirements.repo.create({
      school_id: SCHOOL_A,
      owner_type: 'BUS',
      document_type: BusDocumentType.INSURANCE,
      is_required: true,
      expiry_warning_days: 7,
    } as never);

    // Ten days out: outside a 7-day window, inside the 30-day default.
    const narrowed = await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({ expiry_date: dateInDays(10) }),
    );
    assert.equal(narrowed.status, DocumentStatus.VALID);

    // …and the same lead time on an unconfigured type still says expiring.
    const defaultWindow = await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({
        document_type: BusDocumentType.FITNESS_CERTIFICATE,
        expiry_date: dateInDays(10),
      }),
    );
    assert.equal(defaultWindow.status, DocumentStatus.EXPIRING_SOON);
  });

  it('keeps another school’s configuration out of the result', async () => {
    const { service, requirements } = makeService();
    await requirements.repo.create({
      school_id: SCHOOL_B,
      owner_type: 'BUS',
      document_type: BusDocumentType.PERMIT,
      is_required: false,
      expiry_warning_days: 30,
    } as never);

    const created = await service.createBusDocument(
      SCHOOL_A,
      BUS_A,
      busDocumentBody({ document_type: BusDocumentType.PERMIT }),
    );
    assert.equal(created.is_required, true);
  });
});
