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

/** The four inputs a document cannot be saved without (owner-type independent). */
export interface DocumentRequiredFields {
  document_type: string;
  document_number: string;
  issue_date: string;
  expiry_date: string;
}

const REQUIRED = (label: string): string => `Please enter the ${label}.`;

/** True for `YYYY-MM-DD` that names a real calendar day (not 2026-02-30). */
function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

/**
 * The checks the schema cannot make, because the schema does not require them.
 *
 * `documentDateSchema` is `.nullish()` on both dates and the number is optional
 * on the DTO, so `buildDocumentRequest` would happily send a document with no
 * number and no dates — and an "unknown" expiry is exactly what a compliance
 * screen exists to prevent. A blank field is a *choice* an operator made, not a
 * value the schema can reject, so the form blocks it and says which input.
 *
 * Same rules and same sentences as the web console
 * (`web/src/features/documents/helpers.ts`), so a school admin reads the same
 * words on either surface.
 */
export function documentRequiredFieldErrors(form: DocumentRequiredFields): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.document_type) {
    errors.document_type = 'Please choose a document type.';
  }
  if (form.document_number.trim().length === 0) {
    errors.document_number = REQUIRED('document number');
  }
  for (const [field, label] of [
    ['issue_date', 'issue date'],
    ['expiry_date', 'expiry date'],
  ] as const) {
    const value = form[field].trim();
    if (value.length === 0) {
      errors[field] = REQUIRED(label);
    } else if (!isRealDate(value)) {
      errors[field] = `Please enter the ${label} as a real date, for example 2026-04-01.`;
    }
  }
  const issue = form.issue_date.trim();
  const expiry = form.expiry_date.trim();
  if (
    !errors.issue_date &&
    !errors.expiry_date &&
    isRealDate(issue) &&
    isRealDate(expiry) &&
    Date.parse(expiry) <= Date.parse(issue)
  ) {
    errors.expiry_date = 'Please enter an expiry date after the issue date.';
  }
  return errors;
}

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
  // Required-first, so a half-filled form points at the four inputs that must be
  // filled in rather than at the one schema rule that happened to catch it. The
  // schema still runs afterwards: a date that is present has to be a real ISO
  // date, which a required check alone cannot tell.
  const requiredErrors = documentRequiredFieldErrors(form);
  if (Object.keys(requiredErrors).length > 0) {
    return { ok: false, errors: requiredErrors };
  }

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
