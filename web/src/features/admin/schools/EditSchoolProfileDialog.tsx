'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminSchoolResponse, AdminSchoolUpdateRequest } from '@school-bus-tracking/shared-types';
import { adminSchoolUpdateSchema } from '@school-bus-tracking/validation';
import { Button, Field, Input, Modal, useToast } from '../../../components/ui';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import { apiClient } from '../../../services/api';

interface FormState {
  name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  timezone: string;
}

function schoolToForm(school: AdminSchoolResponse): FormState {
  return {
    name: school.name,
    email: school.email ?? '',
    phone: school.phone ?? '',
    address_line1: school.address_line1 ?? '',
    address_line2: school.address_line2 ?? '',
    city: school.city ?? '',
    state: school.state ?? '',
    postal_code: school.postal_code ?? '',
    country: school.country ?? '',
    timezone: school.timezone,
  };
}

/**
 * Edit School Profile dialog.
 *
 * Edits only the profile fields accepted by the existing
 * `PATCH /admin/schools/:id` contract. Identity fields (`code`, `subdomain`)
 * and lifecycle (`is_active`) are never editable here — deactivation stays on
 * the explicit lifecycle actions. The backend remains the authoritative
 * validator (uniqueness, country format, timezone, max lengths).
 */
export const EditSchoolProfileDialog: React.FC<{
  open: boolean;
  school: AdminSchoolResponse;
  onClose: () => void;
  onSaved: (school: AdminSchoolResponse) => void;
}> = ({ open, school, onClose, onSaved }) => {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => schoolToForm(school));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(schoolToForm(school));
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, school]);

  const setField = useCallback(
    (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value })),
    [],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      const payload: AdminSchoolUpdateRequest = {
        name: form.name,
        email: emptyToNull(form.email),
        phone: emptyToNull(form.phone),
        address_line1: emptyToNull(form.address_line1),
        address_line2: emptyToNull(form.address_line2),
        city: emptyToNull(form.city),
        state: emptyToNull(form.state),
        postal_code: emptyToNull(form.postal_code),
        country: emptyToNull(form.country),
        timezone: form.timezone,
      };
      const parsed = adminSchoolUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        const objectErrors = formErrorsFromZod(parsed.error);
        if (objectErrors.length > 0) setFormError(objectErrors.join(' '));
        return;
      }

      setFieldErrors({});
      setBusy(true);
      try {
        const envelope = await apiClient.updateAdminSchool(school.id, parsed.data);
        const updated = unwrapEnvelope(envelope);
        toast.push('School profile updated', 'success');
        onSaved(updated);
        onClose();
      } catch (caught) {
        setFieldErrors(fieldErrorsFromUnknown(caught));
        setFormError(getApiErrorMessage(caught, 'Could not update the school profile'));
      } finally {
        setBusy(false);
      }
    },
    [form, onClose, onSaved, school.id, toast],
  );

  return (
    <Modal
      title={`Edit ${school.name}`}
      description="Update the tenant's operational and contact details. The tenant code and subdomain cannot be changed here."
      open={open}
      onClose={busy ? () => undefined : onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="grid grid-2" style={{ gap: '0 1rem' }}>
          <Field id="school-profile-name" label="School name" error={fieldErrors.name}>
            <Input
              id="school-profile-name"
              value={form.name}
              disabled={busy}
              error={Boolean(fieldErrors.name)}
              onChange={(event) => setField('name', event.target.value)}
            />
          </Field>
          <Field id="school-profile-code" label="Tenant code" hint="Cannot be changed.">
            <Input id="school-profile-code" value={school.code} disabled />
          </Field>
          <Field id="school-profile-email" label="Email" error={fieldErrors.email}>
            <Input
              id="school-profile-email"
              type="email"
              value={form.email}
              disabled={busy}
              error={Boolean(fieldErrors.email)}
              onChange={(event) => setField('email', event.target.value)}
            />
          </Field>
          <Field id="school-profile-phone" label="Phone" error={fieldErrors.phone}>
            <Input
              id="school-profile-phone"
              value={form.phone}
              disabled={busy}
              error={Boolean(fieldErrors.phone)}
              onChange={(event) => setField('phone', event.target.value)}
            />
          </Field>
          <Field id="school-profile-address-line1" label="Address line 1" error={fieldErrors.address_line1}>
            <Input
              id="school-profile-address-line1"
              value={form.address_line1}
              disabled={busy}
              error={Boolean(fieldErrors.address_line1)}
              onChange={(event) => setField('address_line1', event.target.value)}
            />
          </Field>
          <Field id="school-profile-address-line2" label="Address line 2" error={fieldErrors.address_line2}>
            <Input
              id="school-profile-address-line2"
              value={form.address_line2}
              disabled={busy}
              error={Boolean(fieldErrors.address_line2)}
              onChange={(event) => setField('address_line2', event.target.value)}
            />
          </Field>
          <Field id="school-profile-city" label="City" error={fieldErrors.city}>
            <Input
              id="school-profile-city"
              value={form.city}
              disabled={busy}
              error={Boolean(fieldErrors.city)}
              onChange={(event) => setField('city', event.target.value)}
            />
          </Field>
          <Field id="school-profile-state" label="State / region" error={fieldErrors.state}>
            <Input
              id="school-profile-state"
              value={form.state}
              disabled={busy}
              error={Boolean(fieldErrors.state)}
              onChange={(event) => setField('state', event.target.value)}
            />
          </Field>
          <Field id="school-profile-postal-code" label="Postal code" error={fieldErrors.postal_code}>
            <Input
              id="school-profile-postal-code"
              value={form.postal_code}
              disabled={busy}
              error={Boolean(fieldErrors.postal_code)}
              onChange={(event) => setField('postal_code', event.target.value)}
            />
          </Field>
          <Field id="school-profile-country" label="Country (2-letter ISO)" error={fieldErrors.country}>
            <Input
              id="school-profile-country"
              value={form.country}
              maxLength={2}
              disabled={busy}
              error={Boolean(fieldErrors.country)}
              onChange={(event) => setField('country', event.target.value)}
            />
          </Field>
          <Field id="school-profile-timezone" label="Timezone" error={fieldErrors.timezone}>
            <Input
              id="school-profile-timezone"
              value={form.timezone}
              disabled={busy}
              error={Boolean(fieldErrors.timezone)}
              onChange={(event) => setField('timezone', event.target.value)}
            />
          </Field>
        </div>

        {formError ? (
          <p className="field-error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
