'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useMemo, useState } from 'react';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { Button, Card, Field, PasswordInput, useToast } from '../../components/ui';
import {
  RESET_PASSWORD_FIELDS,
  RESET_PASSWORD_MISSING_TOKEN_MESSAGE,
  RESET_PASSWORD_SUCCESS_TOAST,
  loginPathAfterReset,
  parseResetPasswordForm,
  resetTokenFromQuery,
} from '../../features/auth/password-reset';
import { fieldErrorsFromUnknown, fieldErrorsFromZod, submitErrorMessage } from '../../lib/errors';
import { pickFieldLabels } from '../../lib/field-errors';
import { apiClient } from '../../services/api';

/** The form's own labels, so a message lands under the input it belongs to. */
const FIELD_LABELS = pickFieldLabels(RESET_PASSWORD_FIELDS);

/**
 * `/reset-password?token=…` — step 2 of SCHOOL_ADMIN self-service password
 * reset.
 *
 * The token in the query string *is* the credential, so the page is
 * unauthenticated and does exactly one thing: take a new password twice and
 * post it with the token. On success it redirects to `/login` with a success
 * toast — never to a signed-in screen, because a completed reset revokes
 * every session the account had (including any the attacker held) and mints
 * no new one.
 *
 * ### Why the token never appears in the DOM
 *
 * It is read from the URL and kept in a `useMemo`, not rendered into a hidden
 * input. A hidden field would put a live credential into the page source, the
 * browser's autofill heuristics and any extension that walks the form — for
 * no benefit, since the submit handler already has the value.
 *
 * ### The two password fields use the shared components
 *
 * `PasswordInput` (so the show/hide toggle behaves like every other secret
 * field in the console) and the shared `passwordSchema` through
 * `parseResetPasswordForm`, so the rules the browser enforces are the rules
 * the API enforces.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const token = useMemo(() => resetTokenFromQuery(searchParams), [searchParams]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = parseResetPasswordForm({ token, password, confirmPassword });
    if (!parsed.ok) {
      setFieldErrors(fieldErrorsFromZod(parsed.error, FIELD_LABELS));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await apiClient.resetPassword(parsed.value);
      toast.push(RESET_PASSWORD_SUCCESS_TOAST, 'success');
      router.replace(loginPathAfterReset());
    } catch (error) {
      // A rejected token (unknown, expired, already used) comes back as one
      // generic 400 — shown as the form-level line, because it belongs to no
      // input the user can fix here.
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
            <p className="muted">Choose a new password</p>
          </div>
        </div>

        {token === null ? (
          <p className="field-error" role="alert">
            {RESET_PASSWORD_MISSING_TOKEN_MESSAGE}
          </p>
        ) : (
          <form className="form-grid" onSubmit={(event) => void onSubmit(event)} noValidate>
            <Field
              id="password"
              label="New password"
              error={fieldErrors.password}
              hint="At least 8 characters. Avoid leading or trailing spaces."
            >
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                value={password}
                error={Boolean(fieldErrors.password)}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field
              id="confirm_password"
              label="Confirm new password"
              error={fieldErrors.confirm_password}
            >
              <PasswordInput
                id="confirm_password"
                name="confirm_password"
                autoComplete="new-password"
                value={confirmPassword}
                error={Boolean(fieldErrors.confirm_password)}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            {formError ? (
              <p className="field-error" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link href="/forgot-password" className="linkish" style={{ fontSize: '0.875rem' }}>
            Request a new reset link
          </Link>
        </div>
      </Card>
    </div>
  );
}

/**
 * `useSearchParams()` opts a route into client-side rendering, which Next
 * requires to be wrapped in a `Suspense` boundary or the whole page
 * de-optimises to dynamic rendering with a build warning.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
