import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  BusDocumentType,
  DocumentStatus,
  DriverDocumentType,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { DocumentComplianceService } from './document-compliance.service';
import { DocumentRequirementsService } from './document-requirements.service';
import { DOCUMENTS_BUS_NOT_FOUND_MESSAGE } from './documents.constants';
import { DocumentOverviewQueryDto } from './dto';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const BUS_B = '06060606-0606-4606-8606-060606060602';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';

/** Calendar date `days` from today, in `YYYY-MM-DD`. */
function dateInDays(days: number): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

interface Row {
  id?: string;
  school_id: string;
  [key: string]: unknown;
}

let sequence = 0;

/** In-memory repository with just the query surface the engine uses. */
function makeRepository(prefix: string) {
  const rows: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const operators = value as Record<string, unknown>;
        return Object.entries(operators).every(([op, operand]) => {
          if (op === 'in') return (operand as unknown[]).includes(row[key]);
          return row[key] === operand;
        });
      }
      return row[key] === value;
    });

  return {
    rows,
    repo: {
      create: async (values: Row) => {
        const row: Row = {
          id: `${prefix}-${(sequence += 1)}`,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          ...values,
        };
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

interface Harness {
  compliance: DocumentComplianceService;
  busDocuments: ReturnType<typeof makeRepository>;
  driverDocuments: ReturnType<typeof makeRepository>;
  requirements: ReturnType<typeof makeRepository>;
  buses: ReturnType<typeof makeRepository>;
  users: ReturnType<typeof makeRepository>;
}

function makeHarness(): Harness {
  sequence = 0;
  const busDocuments = makeRepository('bd');
  const driverDocuments = makeRepository('dd');
  const requirements = makeRepository('req');
  const buses = makeRepository('bus');
  const users = makeRepository('user');

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
  const compliance = new DocumentComplianceService(
    busDocuments.repo as never,
    driverDocuments.repo as never,
    buses.repo as never,
    users.repo as never,
    requirementsService,
  );
  return { compliance, busDocuments, driverDocuments, requirements, buses, users };
}

/** Adds a bus document row. */
async function addBusDocument(
  harness: Harness,
  busId: string,
  documentType: BusDocumentType,
  expiryDate: string | null,
  schoolId = SCHOOL_A,
): Promise<void> {
  await harness.busDocuments.repo.create({
    school_id: schoolId,
    bus_id: busId,
    document_type: documentType,
    expiry_date: expiryDate,
    created_at: new Date(),
  });
}

/**
 * Every required bus document, comfortably valid by default.
 *
 * `overrides` sets a specific expiry per type so a test can expire or shorten
 * exactly one document without adding a competing row.
 */
async function fullyDocumentBus(
  harness: Harness,
  busId = BUS_A,
  overrides: Partial<Record<BusDocumentType, string | null>> = {},
): Promise<void> {
  // Partial on purpose: OTHER is optional and stays unfiled unless a test
  // overrides it, so "nothing on file" means what it says.
  const expiries: Partial<Record<BusDocumentType, string | null>> = {
    [BusDocumentType.REGISTRATION_CERTIFICATE]: null,
    [BusDocumentType.INSURANCE]: dateInDays(200),
    [BusDocumentType.FITNESS_CERTIFICATE]: dateInDays(200),
    [BusDocumentType.PERMIT]: dateInDays(200),
    [BusDocumentType.POLLUTION_CERTIFICATE]: dateInDays(200),
    ...overrides,
  };
  for (const [documentType, expiryDate] of Object.entries(expiries)) {
    await addBusDocument(harness, busId, documentType as BusDocumentType, expiryDate);
  }
}

/** The driver's licence. */
async function addLicence(
  harness: Harness,
  driverId: string,
  expiryDate: string | null,
  schoolId = SCHOOL_A,
): Promise<void> {
  await harness.driverDocuments.repo.create({
    school_id: schoolId,
    driver_id: driverId,
    document_type: DriverDocumentType.DRIVING_LICENSE,
    expiry_date: expiryDate,
    created_at: new Date(),
  });
}

const overviewQuery = (
  overrides: Partial<DocumentOverviewQueryDto> = {},
): DocumentOverviewQueryDto => ({ page: 1, limit: 20, ...overrides }) as DocumentOverviewQueryDto;

describe('DocumentComplianceService — bus compliance', () => {
  it('reports every required document as missing when nothing is on file', async () => {
    const harness = makeHarness();
    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);

    assert.equal(result.owner_type, 'BUS');
    assert.equal(result.owner_label, 'BUS-A-1');
    // RC, insurance, fitness, permit and PUC are required by default.
    assert.equal(result.summary.required_total, 5);
    assert.equal(result.summary.missing, 5);
    assert.equal(result.summary.valid, 0);
    assert.equal(result.summary.is_compliant, false);
    assert.equal(result.requirements.filter((item) => item.state === 'MISSING').length, 5);
  });

  it('is compliant when every required document is current', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness);
    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);

    assert.equal(result.summary.valid, 5);
    assert.equal(result.summary.missing, 0);
    assert.equal(result.summary.expired, 0);
    assert.equal(result.summary.expiring_soon, 0);
    assert.equal(result.summary.is_compliant, true);
  });

  it('flags an expired required document and breaks compliance', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness, BUS_A, { [BusDocumentType.INSURANCE]: dateInDays(-1) });

    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    assert.equal(result.summary.expired, 1);
    assert.equal(result.summary.is_compliant, false);

    const insurance = result.requirements.find(
      (item) => item.document_type === BusDocumentType.INSURANCE,
    );
    assert.equal(insurance?.state, 'EXPIRED');
    assert.equal(insurance?.days_remaining, -1);
  });

  it('flags an expiring document without breaking compliance', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness, BUS_A, {
      [BusDocumentType.POLLUTION_CERTIFICATE]: dateInDays(3),
    });

    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    assert.equal(result.summary.expiring_soon, 1);
    assert.equal(result.summary.expired, 0);
    // "Expiring soon" is a warning, not a breach.
    assert.equal(result.summary.is_compliant, true);
  });

  it('ranks the longest-running renewal as the current document', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness);
    // A superseded policy filed *after* its replacement must not win.
    await harness.busDocuments.repo.create({
      school_id: SCHOOL_A,
      bus_id: BUS_A,
      document_type: BusDocumentType.INSURANCE,
      expiry_date: dateInDays(-30),
      created_at: new Date(Date.now() + 60_000),
    });

    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    const insurance = result.requirements.find(
      (item) => item.document_type === BusDocumentType.INSURANCE,
    );
    assert.equal(insurance?.state, 'VALID');
    assert.equal(insurance?.expiry_date, dateInDays(200));
  });

  it('treats a document without an expiry date as permanently valid', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness);
    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    const rc = result.requirements.find(
      (item) => item.document_type === BusDocumentType.REGISTRATION_CERTIFICATE,
    );
    assert.equal(rc?.state, 'VALID');
    assert.equal(rc?.expiry_date, null);
    assert.equal(rc?.days_remaining, null);
  });

  it('hides an optional document type nobody has filed', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness);
    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    assert.equal(
      result.requirements.find((item) => item.document_type === BusDocumentType.OTHER),
      undefined,
    );
  });

  it('reports an optional document once it is filed', async () => {
    const harness = makeHarness();
    await fullyDocumentBus(harness);
    await addBusDocument(harness, BUS_A, BusDocumentType.OTHER, dateInDays(10));
    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    const other = result.requirements.find((item) => item.document_type === BusDocumentType.OTHER);
    assert.equal(other?.is_required, false);
    assert.equal(other?.state, DocumentStatus.EXPIRING_SOON);
    // Optional findings never change the compliance verdict.
    assert.equal(result.summary.is_compliant, true);
  });

  it('honours a school override that makes a required type optional', async () => {
    const harness = makeHarness();
    await harness.requirements.repo.create({
      school_id: SCHOOL_A,
      owner_type: 'BUS',
      document_type: BusDocumentType.PERMIT,
      is_required: false,
      expiry_warning_days: 30,
    });

    await addBusDocument(harness, BUS_A, BusDocumentType.REGISTRATION_CERTIFICATE, null);
    await addBusDocument(harness, BUS_A, BusDocumentType.INSURANCE, dateInDays(200));
    await addBusDocument(harness, BUS_A, BusDocumentType.FITNESS_CERTIFICATE, dateInDays(200));
    await addBusDocument(harness, BUS_A, BusDocumentType.POLLUTION_CERTIFICATE, dateInDays(200));

    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    assert.equal(result.summary.required_total, 4);
    assert.equal(result.summary.missing, 0);
    assert.equal(result.summary.is_compliant, true);
    assert.equal(
      result.requirements.find((item) => item.document_type === BusDocumentType.PERMIT),
      undefined,
    );
  });

  it('honours a shortened warning window', async () => {
    const harness = makeHarness();
    await harness.requirements.repo.create({
      school_id: SCHOOL_A,
      owner_type: 'BUS',
      document_type: BusDocumentType.INSURANCE,
      is_required: true,
      expiry_warning_days: 7,
    });
    // 20 days out: outside a 7-day window, inside the 30-day default.
    await fullyDocumentBus(harness, BUS_A, { [BusDocumentType.INSURANCE]: dateInDays(20) });

    const result = await harness.compliance.getBusCompliance(SCHOOL_A, BUS_A);
    const insurance = result.requirements.find(
      (item) => item.document_type === BusDocumentType.INSURANCE,
    );
    assert.equal(insurance?.state, 'VALID');
  });

  it('refuses a bus of another tenant', async () => {
    const harness = makeHarness();
    await assert.rejects(harness.compliance.getBusCompliance(SCHOOL_A, BUS_B), (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, DOCUMENTS_BUS_NOT_FOUND_MESSAGE);
      return true;
    });
  });
});

describe('DocumentComplianceService — driver compliance', () => {
  it('reports a missing driving licence', async () => {
    const harness = makeHarness();
    const result = await harness.compliance.getDriverCompliance(SCHOOL_A, DRIVER_A);
    assert.equal(result.owner_label, 'Asha Rane');
    assert.equal(result.summary.required_total, 1);
    assert.equal(result.summary.missing, 1);
    assert.equal(result.summary.is_compliant, false);
  });

  it('is compliant once the licence is on file and current', async () => {
    const harness = makeHarness();
    await addLicence(harness, DRIVER_A, dateInDays(365));
    const result = await harness.compliance.getDriverCompliance(SCHOOL_A, DRIVER_A);
    assert.equal(result.summary.valid, 1);
    assert.equal(result.summary.is_compliant, true);
  });

  it('refuses a conductor and a member of another school', async () => {
    const harness = makeHarness();
    await assert.rejects(
      harness.compliance.getDriverCompliance(SCHOOL_A, 'conductor-a'),
      NotFoundException,
    );
    await assert.rejects(
      harness.compliance.getDriverCompliance(SCHOOL_B, DRIVER_A),
      NotFoundException,
    );
  });
});

describe('DocumentComplianceService — school overview', () => {
  it('lists every bus and driver of the school only', async () => {
    const harness = makeHarness();
    const result = await harness.compliance.getOverview(SCHOOL_A, overviewQuery());
    // One bus and one driver belong to school A; the conductor and school B's
    // bus are not part of the compliance surface.
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items.map((item) => item.owner_type).sort(), ['BUS', 'DRIVER']);
  });

  it('aggregates the school summary across every owner', async () => {
    const harness = makeHarness();
    const result = await harness.compliance.getOverview(SCHOOL_A, overviewQuery());
    // 5 required bus documents + 1 required driver document, all missing.
    assert.equal(result.summary.required_total, 6);
    assert.equal(result.summary.missing, 6);
    assert.equal(result.summary.is_compliant, false);
  });

  it('filters down to the resources that need attention', async () => {
    const compliant = makeHarness();
    await fullyDocumentBus(compliant);
    await addLicence(compliant, DRIVER_A, dateInDays(365));

    assert.equal(
      (await compliant.compliance.getOverview(SCHOOL_A, overviewQuery({ compliance: 'attention' })))
        .items.length,
      0,
    );
    assert.equal(
      (await compliant.compliance.getOverview(SCHOOL_A, overviewQuery({ compliance: 'compliant' })))
        .items.length,
      2,
    );

    // An expiring document pushes the bus back into "attention".
    const expiring = makeHarness();
    await fullyDocumentBus(expiring, BUS_A, {
      [BusDocumentType.POLLUTION_CERTIFICATE]: dateInDays(2),
    });
    await addLicence(expiring, DRIVER_A, dateInDays(365));
    const attentionAgain = await expiring.compliance.getOverview(
      SCHOOL_A,
      overviewQuery({ compliance: 'attention' }),
    );
    assert.equal(attentionAgain.items.length, 1);
    assert.equal(attentionAgain.items[0].owner_type, 'BUS');
    assert.equal(attentionAgain.items[0].issues.length, 1);
    assert.equal(attentionAgain.items[0].issues[0].state, 'EXPIRING_SOON');
  });

  it('filters by owner kind and free-text name', async () => {
    const harness = makeHarness();
    const busesOnly = await harness.compliance.getOverview(
      SCHOOL_A,
      overviewQuery({ owner_type: 'BUS' }),
    );
    assert.equal(busesOnly.items.length, 1);

    const driversOnly = await harness.compliance.getOverview(
      SCHOOL_A,
      overviewQuery({ owner_type: 'DRIVER' }),
    );
    assert.equal(driversOnly.items.length, 1);
    assert.equal(driversOnly.items[0].owner_label, 'Asha Rane');

    assert.equal(
      (await harness.compliance.getOverview(SCHOOL_A, overviewQuery({ search: 'asha' }))).items
        .length,
      1,
    );
    assert.equal(
      (await harness.compliance.getOverview(SCHOOL_A, overviewQuery({ search: 'bus-a' }))).items
        .length,
      1,
    );
    assert.equal(
      (await harness.compliance.getOverview(SCHOOL_A, overviewQuery({ search: 'nothing' }))).items
        .length,
      0,
    );
  });

  it('paginates the overview', async () => {
    const harness = makeHarness();
    const firstPage = await harness.compliance.getOverview(SCHOOL_A, overviewQuery({ limit: 1 }));
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.meta.total, 2);
    assert.equal(firstPage.meta.totalPages, 2);
    assert.equal(firstPage.meta.hasNextPage, true);

    const secondPage = await harness.compliance.getOverview(
      SCHOOL_A,
      overviewQuery({ limit: 1, page: 2 }),
    );
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.meta.hasPreviousPage, true);
    assert.notEqual(secondPage.items[0].owner_id, firstPage.items[0].owner_id);
  });

  it('never leaks another tenant’s fleet', async () => {
    const harness = makeHarness();
    await addBusDocument(harness, BUS_B, BusDocumentType.INSURANCE, dateInDays(200), SCHOOL_B);
    const result = await harness.compliance.getOverview(SCHOOL_A, overviewQuery());
    assert.equal(result.items.length, 2);
    assert.equal(
      result.items.some((item) => item.owner_id === BUS_B),
      false,
    );
  });
});
