import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  BusDocumentType,
  DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
  DocumentStatus,
  DriverDocumentType,
  EmergencyStatus,
  EmergencyType,
} from '@school-bus-tracking/shared-types';
import {
  busDocumentCreateSchema,
  busDocumentUpdateSchema,
  deriveDocumentStatus,
  documentDaysRemaining,
  documentListQuerySchema,
  documentOverviewQuerySchema,
  documentRequirementsUpdateSchema,
  driverDocumentCreateSchema,
  emergencyListQuerySchema,
  emergencySosSchema,
  emergencyStatusUpdateSchema,
} from '@school-bus-tracking/validation';

/** A fixed "now" so the derivation tests never depend on the wall clock. */
const NOW = new Date('2026-08-31T12:00:00.000Z');

describe('document validity derivation', () => {
  it('treats a document without an expiry date as valid', () => {
    assert.equal(deriveDocumentStatus(null, { now: NOW }), DocumentStatus.VALID);
    assert.equal(deriveDocumentStatus(undefined, { now: NOW }), DocumentStatus.VALID);
    assert.equal(documentDaysRemaining(null, { now: NOW }), null);
  });

  it('expires a document whose date is in the past', () => {
    assert.equal(deriveDocumentStatus('2026-08-30', { now: NOW }), DocumentStatus.EXPIRED);
    assert.equal(documentDaysRemaining('2026-08-30', { now: NOW }), -1);
  });

  it('counts a document expiring today as expiring soon, not expired', () => {
    assert.equal(deriveDocumentStatus('2026-08-31', { now: NOW }), DocumentStatus.EXPIRING_SOON);
    assert.equal(documentDaysRemaining('2026-08-31', { now: NOW }), 0);
  });

  it('flags the last day of the warning window as expiring soon', () => {
    const status = deriveDocumentStatus('2026-09-30', {
      now: NOW,
      warningDays: DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS,
    });
    assert.equal(status, DocumentStatus.EXPIRING_SOON);
    assert.equal(documentDaysRemaining('2026-09-30', { now: NOW }), 30);
  });

  it('keeps a document valid one day beyond the warning window', () => {
    assert.equal(
      deriveDocumentStatus('2026-10-01', { now: NOW, warningDays: 30 }),
      DocumentStatus.VALID,
    );
  });

  it('honours a per-requirement warning window', () => {
    // Five days out: inside a 7-day window, outside a 3-day window.
    const expiry = '2026-09-05';
    assert.equal(documentDaysRemaining(expiry, { now: NOW }), 5);
    assert.equal(deriveDocumentStatus(expiry, { now: NOW, warningDays: 3 }), DocumentStatus.VALID);
    assert.equal(
      deriveDocumentStatus(expiry, { now: NOW, warningDays: 7 }),
      DocumentStatus.EXPIRING_SOON,
    );
  });

  it('never guesses a validity for an unparsable date', () => {
    assert.equal(documentDaysRemaining('not-a-date', { now: NOW }), null);
    assert.equal(deriveDocumentStatus('not-a-date', { now: NOW }), DocumentStatus.VALID);
  });

  it('accepts a real Date instance as well as an ISO string', () => {
    assert.equal(
      deriveDocumentStatus(new Date('2026-07-01T00:00:00.000Z'), { now: NOW }),
      DocumentStatus.EXPIRED,
    );
  });
});

describe('bus document schemas', () => {
  it('accepts a minimal document with only a type', () => {
    const parsed = busDocumentCreateSchema.safeParse({
      document_type: BusDocumentType.INSURANCE,
    });
    assert.equal(parsed.success, true);
  });

  it('normalizes an empty document number to null', () => {
    const parsed = busDocumentCreateSchema.safeParse({
      document_type: BusDocumentType.PERMIT,
      document_number: '   ',
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.document_number, null);
  });

  it('rejects an unknown document type', () => {
    assert.equal(
      busDocumentCreateSchema.safeParse({ document_type: 'DRIVING_LICENSE' }).success,
      false,
    );
  });

  it('rejects a client-supplied status or tenant id', () => {
    assert.equal(
      busDocumentCreateSchema.safeParse({
        document_type: BusDocumentType.INSURANCE,
        status: 'VALID',
      }).success,
      false,
    );
    assert.equal(
      busDocumentCreateSchema.safeParse({
        document_type: BusDocumentType.INSURANCE,
        school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }).success,
      false,
    );
  });

  it('rejects a malformed date and an impossible calendar date', () => {
    assert.equal(
      busDocumentCreateSchema.safeParse({
        document_type: BusDocumentType.INSURANCE,
        expiry_date: '31/03/2027',
      }).success,
      false,
    );
    assert.equal(
      busDocumentCreateSchema.safeParse({
        document_type: BusDocumentType.INSURANCE,
        expiry_date: '2027-02-31',
      }).success,
      false,
    );
  });

  it('rejects a non http(s) file reference', () => {
    assert.equal(
      busDocumentCreateSchema.safeParse({
        document_type: BusDocumentType.INSURANCE,
        file_url: 'javascript:alert(1)',
      }).success,
      false,
    );
  });

  it('accepts an https file reference', () => {
    const parsed = busDocumentCreateSchema.safeParse({
      document_type: BusDocumentType.INSURANCE,
      file_url: 'https://files.example.test/rc-42.pdf',
      file_name: 'rc-42.pdf',
    });
    assert.equal(parsed.success, true);
  });

  it('rejects an expiry before the issue date on update', () => {
    assert.equal(
      busDocumentUpdateSchema.safeParse({
        issue_date: '2027-01-01',
        expiry_date: '2026-01-01',
      }).success,
      false,
    );
  });

  it('accepts an expiry equal to the issue date on update', () => {
    assert.equal(
      busDocumentUpdateSchema.safeParse({
        issue_date: '2027-01-01',
        expiry_date: '2027-01-01',
      }).success,
      true,
    );
  });
});

describe('driver document schemas', () => {
  it('accepts a driving licence with its licence number', () => {
    const parsed = driverDocumentCreateSchema.safeParse({
      document_type: DriverDocumentType.DRIVING_LICENSE,
      document_number: 'DL-0420110012345',
      issue_date: '2019-05-01',
      expiry_date: '2029-04-30',
    });
    assert.equal(parsed.success, true);
  });

  it('rejects a bus document type on the driver resource', () => {
    assert.equal(
      driverDocumentCreateSchema.safeParse({
        document_type: BusDocumentType.POLLUTION_CERTIFICATE,
      }).success,
      false,
    );
  });
});

describe('document list and requirement schemas', () => {
  it('accepts the derived status filter', () => {
    const parsed = documentListQuerySchema.safeParse({ status: 'EXPIRING_SOON', page: 2 });
    assert.equal(parsed.success, true);
  });

  it('rejects an unknown status filter', () => {
    assert.equal(documentListQuerySchema.safeParse({ status: 'MISSING' }).success, false);
  });

  it('coerces pagination strings and bounds the page size', () => {
    const parsed = documentListQuerySchema.safeParse({ page: '1', limit: '10' });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.page, 1);
    assert.equal(documentListQuerySchema.safeParse({ limit: 500 }).success, false);
  });

  it('accepts a bus requirement override set', () => {
    const parsed = documentRequirementsUpdateSchema.safeParse({
      owner_type: 'BUS',
      items: [
        { document_type: 'INSURANCE', is_required: true, expiry_warning_days: 60 },
        { document_type: 'OTHER', is_required: false },
      ],
    });
    assert.equal(parsed.success, true);
  });

  it('rejects an empty requirement set and an out-of-range warning window', () => {
    assert.equal(
      documentRequirementsUpdateSchema.safeParse({ owner_type: 'BUS', items: [] }).success,
      false,
    );
    assert.equal(
      documentRequirementsUpdateSchema.safeParse({
        owner_type: 'BUS',
        items: [{ document_type: 'INSURANCE', is_required: true, expiry_warning_days: 0 }],
      }).success,
      false,
    );
  });

  it('validates the overview query', () => {
    assert.equal(
      documentOverviewQuerySchema.safeParse({
        owner_type: 'DRIVER',
        compliance: 'attention',
        search: 'ana',
      }).success,
      true,
    );
    assert.equal(
      documentOverviewQuerySchema.safeParse({ compliance: 'everything' }).success,
      false,
    );
  });
});

describe('emergency / SOS schemas', () => {
  it('accepts an SOS with a real position', () => {
    const parsed = emergencySosSchema.safeParse({
      type: EmergencyType.ACCIDENT,
      message: '  Bus hit a divider — no injuries  ',
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 12.5,
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.message, 'Bus hit a divider — no injuries');
  });

  it('accepts an SOS without any position', () => {
    const parsed = emergencySosSchema.safeParse({ type: EmergencyType.MEDICAL });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.latitude, null);
  });

  it('rejects a half coordinate pair', () => {
    assert.equal(
      emergencySosSchema.safeParse({ type: EmergencyType.BREAKDOWN, latitude: 28.6 }).success,
      false,
    );
  });

  it('rejects out-of-range coordinates and a client timestamp', () => {
    assert.equal(
      emergencySosSchema.safeParse({ type: EmergencyType.OTHER, latitude: 120, longitude: 0 })
        .success,
      false,
    );
    assert.equal(
      emergencySosSchema.safeParse({
        type: EmergencyType.OTHER,
        triggered_at: '2020-01-01T00:00:00.000Z',
      }).success,
      false,
    );
  });

  it('accepts a status transition and rejects an unknown status', () => {
    assert.equal(
      emergencyStatusUpdateSchema.safeParse({
        status: EmergencyStatus.ACKNOWLEDGED,
        note: 'School van dispatched',
      }).success,
      true,
    );
    assert.equal(emergencyStatusUpdateSchema.safeParse({ status: 'OPENING' }).success, false);
  });

  it('validates the emergency list query', () => {
    assert.equal(
      emergencyListQuerySchema.safeParse({
        status: EmergencyStatus.OPEN,
        type: EmergencyType.MEDICAL,
        date_from: '2026-08-01',
        date_to: '2026-08-31',
      }).success,
      true,
    );
    assert.equal(emergencyListQuerySchema.safeParse({ date_from: '01-08-2026' }).success, false);
  });
});
