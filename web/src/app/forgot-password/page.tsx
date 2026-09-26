'use client';

import Link from 'next/link';
import Image from 'next/image';
import React, { useState } from 'react';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { Button, Card, Field, Input } from '../../components/ui';
import {
  FORGOT_PASSWORD_FIELDS,
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  parseForgotPasswordForm,
} from '../../features/auth/password-reset';
import { fieldErrorsFromUnknown, fieldErrorsFromZod, submitErrorMessage } from '../../lib/errors';
import { pickFieldLabels } from '../../lib/field-errors';
import { apiClient } from '../../services/api';

/** The form's own labels, so a message lands under the input it belongs to. */
const FIELD_LABELS = pickFieldLabels(FORGOT_PASSWORD_FIELDS);

/**
 * `/forgot-password` — step 1 of SCHOOL_ADMIN self-service password reset.
 *
 * Same two fields as the login form, with the same labels and the same hint,
 * because it is the same two things the admin already knows: their school
 * code and their email. (There is no "platform administrator leave this
 * blank" case here — self-service reset is SCHOOL_ADMIN-only, so the school
 * code is required.)
 *
 * ### The screen says the same thing every time
 *
 * On success the page swaps to a single fixed confirmation —
 * {@link FORGOT_PASSWORD_GENERIC_MESSAGE}, word for word the server's — and
 * it is shown whether the email matched an admin, matched a driver, matched
 * nobody, or named a school that does not exist. The server refuses to tell
 * the browser which case applied precisely so that this screen *cannot* leak
 * it; rendering anything conditional here would hand back the account
 * enumeration the endpoint was designed to prevent.
 *
 * Only two things still produce visible differences, and both are about the
 * *request* rather than the account: a 400 from the shape validation (the
 * email is not an email), and a 429 from the public reset rate limit.
 */
export default function ForgotPasswordPage() {
  const [schoolId, setSchoolId] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = parseForgotPasswordForm({ schoolId, email });
    if (!parsed.ok) {
      setFieldErrors(fieldErrorsFromZod(parsed.error, FIELD_LABELS));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await apiClient.forgotPassword(parsed.value);
      // Deliberately ignores the response body: it is the same sentence for
      // every outcome, and reading it would invite a future change that
      // renders something account-specific.
      setSubmitted(true);
    } catch (error) {
      setFieldErrors(fieldErrorsFromUnknown(error, FIELD_LABELS));
      setFormError(submitErrorMessage(error, FIELD_LABELS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <Card className="login-card">
        <div className="row" style={{ marginBottom: '1rem' }}>
          <span className="brand-mark">
            <Image src="/kidbus-mark.svg" alt="" width={42} height={42} style={{ width: 'auto' }} priority />
          </span>
          <div>
            <h1 style={{ fontSize: '1.2rem' }}>{APP_CONFIG.appName}</h1>
            <p className="muted">Reset your school administrator password</p>
          </div>
        </div>

        {submitted ? (
          <>
            <p role="status">{FORGOT_PASSWORD_GENERIC_MESSAGE}</p>
            <p className="muted" style={{ fontSize: '0.875rem' }}>
              The link in the email can only be used once and expires shortly after it is sent. If
              it does not arrive, check your spam folder before requesting another.
            </p>
          </>
        ) : (
          <form className="form-grid" onSubmit={(event) => void onSubmit(event)} noValidate>
            <Field
              id="school_id"
              label="School code"
              error={fieldErrors.school_id}
              hint="Enter your school's short code (for example, triumph-academy). A school UUID also works for existing accounts."
            >
              <Input
                id="school_id"
                name="school_id"
                placeholder="triumph-academy"
                autoComplete="organization"
                value={schoolId}
                error={Boolean(fieldErrors.school_id)}
                onChange={(event) => setSchoolId(event.target.value)}
              />
            </Field>
            <Field id="email" label="Email" error={fieldErrors.email}>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                error={Boolean(fieldErrors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {formError ? (
              <p className="field-error" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a reset link'}
            </Button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link href="/login" className="linkish" style={{ fontSize: '0.875rem' }}>
            ← Back to sign in
          </Link>
        </div>
      </Card>
    </div>
  );
}
