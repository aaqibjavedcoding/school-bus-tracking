'use client';

import React, { useState } from 'react';
import {
  BUS_DOCUMENT_TYPE_LABELS,
  BUS_DOCUMENT_TYPE_VALUES,
  BusDocumentType,
  DRIVER_DOCUMENT_TYPE_LABELS,
  DRIVER_DOCUMENT_TYPE_VALUES,
  DriverDocumentType,
  type BusDocumentResponse,
  type DriverDocumentResponse,
  type DocumentOwnerType,
} from '@school-bus-tracking/shared-types';
import {
  busDocumentCreateSchema,
  busDocumentUpdateSchema,
  driverDocumentCreateSchema,
  driverDocumentUpdateSchema,
} from '@school-bus-tracking/validation';
import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { emptyToNull, fieldErrorsFromZod } from '../../lib/errors';

/**
 * Create / edit form for one compliance document (Task 44).
 *
 * The same component serves bus and driver documents — the two resources carry
 * different catalogues but identical fields — which keeps the two screens and
 * the mobile equivalent from drifting apart.
 *
 * There is deliberately **no status field**: validity is derived by the API
 * from the real issue/expiry dates, so an expired certificate cannot be
 * "marked valid" from the UI. The client still validates with the shared Zod
 * schemas so a mistake is caught before the round trip.
 */

/**
 * The validated request body.
 *
 * It is typed as a plain record so one builder can serve all four shapes
 * (bus/driver × create/update); each screen casts it to the exact request type
 * of the endpoint it calls, and the shared Zod schema has already guaranteed
 * the shape is right.
 */
export type DocumentRequestBody = Record<string, unknown>;

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
  ownerType: DocumentOwnerType,
  document: BusDocumentResponse | DriverDocumentResponse,
): DocumentFormValues {
  void ownerType;
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

/** Builds the request body, validating with the shared schema first. */
export function buildDocumentRequest(
  ownerType: DocumentOwnerType,
  form: DocumentFormValues,
  editing: boolean,
): { ok: true; body: DocumentRequestBody } | { ok: false; errors: Record<string, string> } {
  const payload = {
    document_type: form.document_type,
    document_number: emptyToNull(form.document_number),
    issue_date: emptyToNull(form.issue_date),
    expiry_date: emptyToNull(form.expiry_date),
    notes: emptyToNull(form.notes),
    file_name: emptyToNull(form.file_name),
    file_url: emptyToNull(form.file_url),
  };

  const schema = editing
    ? ownerType === 'BUS'
      ? busDocumentUpdateSchema
      : driverDocumentUpdateSchema
    : ownerType === 'BUS'
      ? busDocumentCreateSchema
      : driverDocumentCreateSchema;

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFromZod(parsed.error) };
  }
  return { ok: true, body: parsed.data as DocumentRequestBody };
}

export const DocumentFormModal: React.FC<{
  ownerType: DocumentOwnerType;
  open: boolean;
  editing: BusDocumentResponse | DriverDocumentResponse | null;
  form: DocumentFormValues;
  fieldErrors: Record<string, string>;
  busy: boolean;
  onChange: (form: DocumentFormValues) => void;
  onClose: () => void;
  onSubmit: () => void;
}> = ({ ownerType, open, editing, form, fieldErrors, busy, onChange, onClose, onSubmit }) => {
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<DocumentFormValues>) => {
    setFormError(null);
    onChange({ ...form, ...patch });
  };

  const isBus = ownerType === 'BUS';
  const options: Array<{ value: string; label: string }> = (
    isBus ? (BUS_DOCUMENT_TYPE_VALUES as string[]) : (DRIVER_DOCUMENT_TYPE_VALUES as string[])
  ).map((value) => ({
    value,
    label: isBus
      ? BUS_DOCUMENT_TYPE_LABELS[value as BusDocumentType]
      : DRIVER_DOCUMENT_TYPE_LABELS[value as DriverDocumentType],
  }));

  return (
    <Modal open={open} title={editing ? 'Edit document' : 'Add document'} onClose={onClose}>
      <Field
        id="document-type"
        label="Document type"
        error={fieldErrors.document_type}
        hint={
          isBus
            ? 'RC, insurance, fitness, permit, PUC or anything else the school tracks.'
            : 'The driving licence first, plus whatever else the school requires.'
        }
      >
        <Select
          id="document-type"
          value={form.document_type}
          placeholder="Select a document type…"
          options={options}
          onChange={(event) => set({ document_type: event.target.value })}
        />
      </Field>

      <Field
        id="document-number"
        label="Document number"
        error={fieldErrors.document_number}
        hint="Licence number, policy number, registration number…"
      >
        <Input
          id="document-number"
          value={form.document_number}
          onChange={(event) => set({ document_number: event.target.value })}
          placeholder="e.g. DL-0420110012345"
        />
      </Field>

      <Field
        id="issue-date"
        label="Issue date"
        error={fieldErrors.issue_date}
        hint="Leave empty if the issue date is unknown."
      >
        <Input
          id="issue-date"
          type="date"
          value={form.issue_date}
          onChange={(event) => set({ issue_date: event.target.value })}
        />
      </Field>

      <Field
        id="expiry-date"
        label="Expiry date"
        error={fieldErrors.expiry_date}
        hint="Validity is calculated from this date — leave empty if the document never expires."
      >
        <Input
          id="expiry-date"
          type="date"
          value={form.expiry_date}
          onChange={(event) => set({ expiry_date: event.target.value })}
        />
      </Field>

      <Field
        id="file-name"
        label="File name"
        error={fieldErrors.file_name}
        hint="Optional label of the attached copy."
      >
        <Input
          id="file-name"
          value={form.file_name}
          onChange={(event) => set({ file_name: event.target.value })}
          placeholder="insurance-2026.pdf"
        />
      </Field>

      <Field
        id="file-url"
        label="File link"
        error={fieldErrors.file_url}
        hint="Optional http(s) link to the copy held in the school's own document store."
      >
        <Input
          id="file-url"
          type="url"
          value={form.file_url}
          onChange={(event) => set({ file_url: event.target.value })}
          placeholder="https://…"
        />
      </Field>

      <Field id="notes" label="Notes" error={fieldErrors.notes}>
        <Textarea
          id="notes"
          rows={3}
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
        />
      </Field>

      {formError ? (
        <p className="field-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => {
            if (!form.document_type) {
              setFormError('Choose a document type.');
              return;
            }
            setFormError(null);
            onSubmit();
          }}
          disabled={busy}
        >
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add document'}
        </Button>
      </div>
    </Modal>
  );
};
