import type {
  BusDocumentCreateRequest,
  BusDocumentResponse,
  BusDocumentUpdateRequest,
  DocumentOwnerType,
  DriverDocumentCreateRequest,
  DriverDocumentResponse,
  DriverDocumentUpdateRequest,
} from '@school-bus-tracking/shared-types';
import {
  busDocumentCreateSchema,
  busDocumentUpdateSchema,
  driverDocumentCreateSchema,
  driverDocumentUpdateSchema,
} from '@school-bus-tracking/validation';
import { emptyToNull, fieldErrorsFromZod } from '../../../lib/errors.ts';

/**
 * Pure half of the compliance-document form (Task 44).
 *
 * Split out of `DocumentFormSheet.tsx` so the validation rules — the part a
 * mistake can hide in — are unit-testable without React Native, exactly like
 * the API's own DTO tests.
 *
 * There is no status field anywhere in here: validity is derived by the server
 * from the real expiry date, so the only way to change a document's status is
 * to correct its dates.
 */

export interface DocumentFormValues {
  document_type: string;
  document_number: string;
  issue_date: string;
  expiry_date: string;
  notes: string;
  file_name: string;
  file_url: string;
}

export const EMPTY_DOCUMENT_FORM: DocumentFormValues = {
  document_type: '',
  document_number: '',
  issue_date: '',
  expiry_date: '',
  notes: '',
  file_name: '',
  file_url: '',
};

export function toFormValues(
  document: BusDocumentResponse | DriverDocumentResponse,
): DocumentFormValues {
  return {
    document_type: document.document_type,
    document_number: document.document_number ?? '',
    issue_date: document.issue_date ?? '',
    expiry_date: document.expiry_date ?? '',
    notes: document.notes ?? '',
    file_name: document.file_name ?? '',
    file_url: document.file_url ?? '',
  };
}

/** Narrowed by each screen to the exact request type of its endpoint. */
export type DocumentRequest =
  | BusDocumentCreateRequest
  | BusDocumentUpdateRequest
  | DriverDocumentCreateRequest
  | DriverDocumentUpdateRequest;

export type DocumentRequestResult =
  { ok: true; body: DocumentRequest } | { ok: false; errors: Record<string, string> };

/**
 * Validates and normalises the form into a request body.
 *
 * Returns a discriminated union instead of throwing so the sheet can render
 * per-field errors from the same shared schema the API enforces. Empty strings
 * become `null` rather than being sent as blank values — "unknown issue date"
 * and "empty issue date" must not be the same thing in the database.
 */
export function buildDocumentRequest(
  ownerType: DocumentOwnerType,
  form: DocumentFormValues,
  editing: boolean,
): DocumentRequestResult {
  const payload = {
    document_type: form.document_type,
    document_number: emptyToNull(form.document_number),
    issue_date: emptyToNull(form.issue_date),
    expiry_date: emptyToNull(form.expiry_date),
    notes: emptyToNull(form.notes),
    file_name: emptyToNull(form.file_name),
    file_url: emptyToNull(form.file_url),
  };

  const schema =
    ownerType === 'BUS'
      ? editing
        ? busDocumentUpdateSchema
        : busDocumentCreateSchema
      : editing
        ? driverDocumentUpdateSchema
        : driverDocumentCreateSchema;

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }
  return { ok: true, body: parsed.data as DocumentRequest };
}
