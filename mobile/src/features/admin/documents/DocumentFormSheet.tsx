import React from 'react';
import {
  BUS_DOCUMENT_TYPE_LABELS,
  BUS_DOCUMENT_TYPE_VALUES,
  DRIVER_DOCUMENT_TYPE_LABELS,
  DRIVER_DOCUMENT_TYPE_VALUES,
  type BusDocumentResponse,
  type DocumentOwnerType,
  type DriverDocumentResponse,
} from '@school-bus-tracking/shared-types';
import { Button, Field, FormSheet, Select, type SelectOption } from '../../../components';
import type { DocumentFormValues } from './documentForm';

/**
 * Create / edit sheet for one compliance document (Task 44).
 *
 * One component serves bus and driver documents: the two resources carry
 * different catalogues but identical fields, so the two screens — and the web
 * console's `DocumentFormModal` — cannot drift apart.
 *
 * There is deliberately **no status field**. Validity is derived by the API
 * from the real expiry date, so an expired certificate can never be "marked
 * valid" from a phone. The client validates with the shared Zod schemas so a
 * mistake is caught before the round trip.
 */

export const DocumentFormSheet: React.FC<{
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
  const set = (patch: Partial<DocumentFormValues>) => onChange({ ...form, ...patch });
  const isBus = ownerType === 'BUS';

  const options: SelectOption[] = (
    isBus ? (BUS_DOCUMENT_TYPE_VALUES as string[]) : (DRIVER_DOCUMENT_TYPE_VALUES as string[])
  ).map((value) => ({
    value,
    label: isBus
      ? BUS_DOCUMENT_TYPE_LABELS[value as keyof typeof BUS_DOCUMENT_TYPE_LABELS]
      : DRIVER_DOCUMENT_TYPE_LABELS[value as keyof typeof DRIVER_DOCUMENT_TYPE_LABELS],
  }));

  return (
    <FormSheet
      open={open}
      title={editing ? 'Edit document' : 'Add document'}
      onClose={onClose}
      footer={
        <>
          <Button label="Cancel" variant="secondary" onPress={onClose} busy={busy} />
          <Button
            label={editing ? 'Save changes' : 'Add document'}
            onPress={onSubmit}
            busy={busy}
          />
        </>
      }
    >
      <Select
        label="Document type"
        value={form.document_type}
        options={options}
        placeholder="Select a document type…"
        error={fieldErrors.document_type ?? null}
        onChange={(value) => set({ document_type: value })}
      />
      <Field
        label="Document number"
        value={form.document_number}
        onChangeText={(text) => set({ document_number: text })}
        hint="Licence number, policy number, registration number…"
        placeholder="e.g. DL-0420110012345"
        autoCapitalize="characters"
        error={fieldErrors.document_number}
      />
      {/* Dates are plain YYYY-MM-DD text: the web console uses a native date
          picker, and a typed ISO date keeps both clients sending exactly the
          same payload the API validates. */}
      <Field
        label="Issue date (YYYY-MM-DD)"
        value={form.issue_date}
        onChangeText={(text) => set({ issue_date: text })}
        hint="Leave empty if the issue date is unknown."
        placeholder="2026-04-01"
        error={fieldErrors.issue_date}
      />
      <Field
        label="Expiry date (YYYY-MM-DD)"
        value={form.expiry_date}
        onChangeText={(text) => set({ expiry_date: text })}
        hint="Validity is calculated from this date — leave empty if it never expires."
        placeholder="2027-03-31"
        error={fieldErrors.expiry_date}
      />
      <Field
        label="File name"
        value={form.file_name}
        onChangeText={(text) => set({ file_name: text })}
        hint="Optional label of the attached copy."
        placeholder="insurance-2026.pdf"
        error={fieldErrors.file_name}
      />
      <Field
        label="File link"
        value={form.file_url}
        onChangeText={(text) => set({ file_url: text })}
        hint="Optional http(s) link to the copy held in the school's own store."
        placeholder="https://…"
        keyboardType="url"
        autoCapitalize="none"
        error={fieldErrors.file_url}
      />
      <Field
        label="Notes"
        value={form.notes}
        onChangeText={(text) => set({ notes: text })}
        hint="Anything the office should know about this document."
        multiline
        error={fieldErrors.notes}
      />
    </FormSheet>
  );
};
