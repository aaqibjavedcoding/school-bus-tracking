'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminSchoolAdminResetPasswordRequest } from '@school-bus-tracking/shared-types';
import { adminSchoolAdminResetPasswordSchema } from '@school-bus-tracking/validation';
import { Button, Field, Input, Modal } from '../../../components/ui';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
} from '../../../lib/errors';
import { fullName } from '../../../lib/format';
import type { SubmitResult } from './SchoolAdminFormDialog';

/**
 * Reset Password dialog for a SCHOOL_ADMIN.
 *
 * The password is sent once, hashed by the backend, and never returned. The
 * form is disabled while submitting so a double click cannot issue two reset
 * requests.
 */
export const ResetPasswordDialog: React.FC<{
  open: boolean;
  schoolName: string;
  admin: { id: string; first_name: string; last_name: string };
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: AdminSchoolAdminResetPasswordRequest) => Promise<SubmitResult>;
}> = ({ open, schoolName, admin, busy, onClose, onSubmit }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setConfirm('');
      setFieldErrors({});
      setFormError(null);
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);

      let currentErrors: Record<string, string> = {};
      if (password !== confirm) {
        currentErrors = { confirm: 'Passwords do not match' };
      }
      const parsed = adminSchoolAdminResetPasswordSchema.safeParse({ password });
      if (!parsed.success) {
        currentErrors = { ...currentErrors, ...fieldErrorsFromZod(parsed.error) };
      }
      if (Object.keys(currentErrors).length > 0) {
        setFieldErrors(currentErrors);
        if (!parsed.success) {
          const objectErrors = formErrorsFromZod(parsed.error);
          if (objectErrors.length > 0) setFormError(objectErrors.join(' '));
        }
        return;
      }

      setFieldErrors({});
      const result = await onSubmit({ password });
      if (result) {
        setFormError(result.message);
        setFieldErrors(fieldErrorsFromUnknown(result.error));
        setPassword('');
        setConfirm('');
      }
    },
    [confirm, password, onSubmit],
  );

  return (
    <Modal
      title={`Reset password for ${fullName(admin)}`}
      description={`The next time this admin signs in to ${schoolName} they must use the new password. The old one stops working immediately.`}
      open={open}
      onClose={busy ? () => undefined : onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Field id="reset-password" label="New password" hint="At least 8 characters." error={fieldErrors.password}>
          <Input
            id="reset-password"
            type="password"
            value={password}
            disabled={busy}
            error={Boolean(fieldErrors.password)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field id="reset-password-confirm" label="Confirm new password" error={fieldErrors.confirm}>
          <Input
            id="reset-password-confirm"
            type="password"
            value={confirm}
            disabled={busy}
            error={Boolean(fieldErrors.confirm)}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

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
            {busy ? 'Resetting…' : 'Reset password'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
