'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  type AdminSchoolAdminCreateRequest,
  type AdminSchoolAdminResponse,
  type AdminSchoolAdminUpdateRequest,
} from '@school-bus-tracking/shared-types';
import {
  adminSchoolAdminCreateSchema,
  adminSchoolAdminUpdateSchema,
} from '@school-bus-tracking/validation';
import { Button, Field, Input, Modal, Select } from '../../../components/ui';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
} from '../../../lib/errors';
import { fullName } from '../../../lib/format';

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone: string;
  is_active: 'true' | 'false';
}

const EMPTY: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  phone: '',
  is_active: 'true',
};

function adminToForm(admin: AdminSchoolAdminResponse): FormState {
  return {
    first_name: admin.first_name,
    last_name: admin.last_name,
    email: admin.email,
    password: '',
    phone: admin.phone ?? '',
    is_active: admin.is_active ? 'true' : 'false',
  };
}

/** `null` on success; otherwise the message and raw server error. */
export type SubmitResult = null | { message: string; error?: unknown };

/**
 * Create / Edit School Admin dialog.
 *
 * Validation uses the shared zod contracts (fast client-side feedback);
 * the backend remains authoritative for uniqueness, role and tenant rules.
 * A separate Reset Password dialog handles password rotation — this edit
 * form intentionally does not pre-fill or send a password.
 */
export const SchoolAdminFormDialog: React.FC<{
  open: boolean;
  mode: 'create' | 'edit';
  schoolName: string;
  admin: AdminSchoolAdminResponse | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    body: AdminSchoolAdminCreateRequest | AdminSchoolAdminUpdateRequest,
  ) => Promise<SubmitResult>;
}> = ({ open, mode, schoolName, admin, busy, onClose, onSubmit }) => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(admin ? adminToForm(admin) : EMPTY);
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, admin]);

  const setField = useCallback(
    (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value })),
    [],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      const base = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: emptyToNull(form.phone),
      };

      if (mode === 'create') {
        const payload: AdminSchoolAdminCreateRequest = {
          ...base,
          password: form.password,
          is_active: form.is_active === 'true',
        };
        const parsed = adminSchoolAdminCreateSchema.safeParse(payload);
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          const objectErrors = formErrorsFromZod(parsed.error);
          if (objectErrors.length > 0) setFormError(objectErrors.join(' '));
          return;
        }
        setFieldErrors({});
        const result = await onSubmit(parsed.data as AdminSchoolAdminCreateRequest);
        if (result) {
          setFormError(result.message);
          setFieldErrors(fieldErrorsFromUnknown(result.error));
        }
        return;
      }

      const payload: AdminSchoolAdminUpdateRequest = {
        ...base,
        is_active: form.is_active === 'true',
      };
      const parsed = adminSchoolAdminUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        const objectErrors = formErrorsFromZod(parsed.error);
        if (objectErrors.length > 0) setFormError(objectErrors.join(' '));
        return;
      }
      setFieldErrors({});
      const result = await onSubmit(parsed.data as AdminSchoolAdminUpdateRequest);
      if (result) {
        setFormError(result.message);
        setFieldErrors(fieldErrorsFromUnknown(result.error));
      }
    },
    [form, mode, onSubmit],
  );

  const title =
    mode === 'create' ? `Add school admin to ${schoolName}` : `Edit ${fullName(admin ?? { first_name: '', last_name: '' })}`;

  return (
    <Modal
      title={title}
      description={
        mode === 'create'
          ? 'Create a new SCHOOL_ADMIN account for this tenant. Credentials are never returned.'
          : 'Update the profile and activation state. Use Reset Password to rotate credentials.'
      }
      open={open}
      onClose={busy ? () => undefined : onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="grid grid-2" style={{ gap: '0 1rem' }}>
          <Field id="school-admin-first-name" label="First name" error={fieldErrors.first_name}>
            <Input
              id="school-admin-first-name"
              value={form.first_name}
              disabled={busy}
              error={Boolean(fieldErrors.first_name)}
              onChange={(event) => setField('first_name', event.target.value)}
            />
          </Field>
          <Field id="school-admin-last-name" label="Last name" error={fieldErrors.last_name}>
            <Input
              id="school-admin-last-name"
              value={form.last_name}
              disabled={busy}
              error={Boolean(fieldErrors.last_name)}
              onChange={(event) => setField('last_name', event.target.value)}
            />
          </Field>
          <Field id="school-admin-email" label="Email" error={fieldErrors.email}>
            <Input
              id="school-admin-email"
              type="email"
              value={form.email}
              disabled={busy}
              error={Boolean(fieldErrors.email)}
              onChange={(event) => setField('email', event.target.value)}
            />
          </Field>
          {mode === 'create' ? (
            <Field
              id="school-admin-password"
              label="Password"
              hint="At least 8 characters."
              error={fieldErrors.password}
            >
              <Input
                id="school-admin-password"
                type="password"
                value={form.password}
                disabled={busy}
                error={Boolean(fieldErrors.password)}
                onChange={(event) => setField('password', event.target.value)}
              />
            </Field>
          ) : null}
          <Field id="school-admin-phone" label="Phone" error={fieldErrors.phone}>
            <Input
              id="school-admin-phone"
              value={form.phone}
              disabled={busy}
              error={Boolean(fieldErrors.phone)}
              onChange={(event) => setField('phone', event.target.value)}
            />
          </Field>
          <Field
            id="school-admin-active"
            label="Status"
            hint="Deactivated admins cannot sign in but keep their account and history."
            error={fieldErrors.is_active}
          >
            <Select
              id="school-admin-active"
              value={form.is_active}
              disabled={busy}
              onChange={(event) => setField('is_active', event.target.value)}
              options={[
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
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
            {busy
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Add admin'
                : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
