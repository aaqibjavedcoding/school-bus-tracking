import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BusDocumentType,
  DriverDocumentType,
  type BusDocumentResponse,
} from '@school-bus-tracking/shared-types';
import {
  EMPTY_DOCUMENT_FORM,
  buildDocumentRequest,
  toFormValues,
  type DocumentFormValues,
} from './documentForm.ts';

/**
 * The mobile document form runs the *same* shared Zod schemas as the API, so
 * these cases double as a contract check: anything accepted here must be
 * accepted by the backend, and anything rejected here is rejected before a
 * round trip.
 */

const form = (overrides: Partial<DocumentFormValues> = {}): DocumentFormValues => ({
  ...EMPTY_DOCUMENT_FORM,
  document_type: BusDocumentType.INSURANCE,
  document_number: 'POL-998877',
  issue_date: '2026-04-01',
  expiry_date: '2027-03-31',
  ...overrides,
});

const document = (): BusDocumentResponse =>
  ({
    id: 'doc-1',
    school_id: 'school-1',
    bus_id: 'bus-1',
    document_type: BusDocumentType.INSURANCE,
    document_type_label: 'Insurance',
    document_number: 'POL-998877',
    issue_date: '2026-04-01',
    expiry_date: '2027-03-31',
    notes: null,
    file_name: null,
    file_url: null,
    status: 'VALID',
    days_remaining: 200,
    is_required: true,
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
  }) as unknown as BusDocumentResponse;

describe('buildDocumentRequest', () => {
  it('builds a valid bus create body', () => {
    const result = buildDocumentRequest('BUS', form(), false);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.body, {
      document_type: 'INSURANCE',
      document_number: 'POL-998877',
      issue_date: '2026-04-01',
      expiry_date: '2027-03-31',
      notes: null,
      file_name: null,
      file_url: null,
    });
  });

  it('turns blank optional fields into null instead of empty strings', () => {
    const result = buildDocumentRequest(
      'BUS',
      form({ document_number: '   ', notes: '', file_name: '', file_url: '' }),
      false,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.document_number, null);
    assert.equal(result.body.notes, null);
  });

  it('rejects an unknown document type with a field error', () => {
    const result = buildDocumentRequest('BUS', form({ document_type: 'MOT' }), false);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.document_type);
  });

  it('rejects a bus document type on the driver catalogue and vice versa', () => {
    const asDriver = buildDocumentRequest('DRIVER', form(), false);
    assert.equal(asDriver.ok, false);

    const asBus = buildDocumentRequest(
      'BUS',
      form({ document_type: DriverDocumentType.DRIVING_LICENSE }),
      false,
    );
    assert.equal(asBus.ok, false);
  });

  it('rejects an expiry date before the issue date', () => {
    const result = buildDocumentRequest(
      'BUS',
      form({ issue_date: '2027-01-01', expiry_date: '2026-01-01' }),
      true,
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.expiry_date);
  });

  it('accepts a non-http file reference only when it is a real http(s) URL', () => {
    const bad = buildDocumentRequest('BUS', form({ file_url: 'javascript:alert(1)' }), false);
    assert.equal(bad.ok, false);

    const good = buildDocumentRequest(
      'BUS',
      form({ file_url: 'https://school.example/docs/insurance.pdf', file_name: 'insurance.pdf' }),
      false,
    );
    assert.equal(good.ok, true);
  });

  /**
   * A partial update keeps the type: the sheet always pre-fills it from the
   * record being edited, and the screen refuses to submit without one. The
   * point of the case is that every *other* field may be left alone.
   */
  it('allows an update that only changes one field', () => {
    const result = buildDocumentRequest(
      'BUS',
      form({ document_number: '', issue_date: '', expiry_date: '', notes: 'Renewed' }),
      true,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.body.document_type, 'INSURANCE');
    assert.equal(result.body.notes, 'Renewed');
    assert.equal(result.body.expiry_date, null);
  });

  it('refuses to build an update without a document type', () => {
    // Mirrors the guard in the sheet: the form never reaches the API blank.
    const result = buildDocumentRequest('BUS', { ...EMPTY_DOCUMENT_FORM, notes: 'Renewed' }, true);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.document_type);
  });
});

describe('toFormValues', () => {
  it('round-trips a document into the editable form', () => {
    assert.deepEqual(toFormValues(document()), {
      document_type: 'INSURANCE',
      document_number: 'POL-998877',
      issue_date: '2026-04-01',
      expiry_date: '2027-03-31',
      notes: '',
      file_name: '',
      file_url: '',
    });
  });

  it('renders a null field as an empty input, never as "null"', () => {
    const values = toFormValues({ ...document(), notes: null, file_url: null });
    assert.equal(values.notes, '');
    assert.equal(values.file_url, '');
  });
});
