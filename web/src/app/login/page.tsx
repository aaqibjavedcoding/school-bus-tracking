'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { loginSchema } from '@school-bus-tracking/validation';
import { Button, Card, Field, Input, PasswordInput, useToast } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  RESET_PASSWORD_SUCCESS_TOAST,
  isPostResetLogin,
} from '../../features/auth/password-reset';
import { fieldErrorsFromUnknown, fieldErrorsFromZod, submitErrorMessage } from '../../lib/errors';
import { pickFieldLabels } from '../../lib/field-errors';
import { homePath } from '../../lib/roles';

/**
 * The login form's own label map.
 *
 * The API rejects a bad credential set with the same flat message array any
 * other form gets, so the two fields are attributed by label and the sentence
 * lands under the input it belongs to. `school_id` is the school *code* here —
 * the same value under two names, which is exactly why a form states its own
 * labels instead of trusting a global guess.
 */
const LOGIN_FIELD_LABELS = pickFieldLabels(['school_id', 'email', 'password']);

function LoginForm() {
  const { login, status, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [schoolId, setSchoolId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      router.replace(homePath(user.role));
    }
  }, [status, user, router]);

  /**
   * `/login?reset=1` — the landing spot after a completed password reset.
   *
   * The reset page redirects here rather than signing the user in, because
   * finishing a reset revokes every session the account had and mints no new
   * one. The flag is all that crosses: the sentence itself is a constant, so
   * the login screen can never be made to render arbitrary text handed to it
   * in a URL.
   *
   * The ref keeps React 18 StrictMode's double-invoked effect from stacking
   * two identical toasts in development.
   */
  const resetToastShown = useRef(false);
  useEffect(() => {
    if (resetToastShown.current || !isPostResetLogin(searchParams)) {
      return;
    }
    resetToastShown.current = true;
    toast.push(RESET_PASSWORD_SUCCESS_TOAST, 'success');
  }, [searchParams, toast]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse({
      school_id: schoolId.trim() === '' ? null : schoolId.trim(),
      email: email.trim(),
      password,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await login(parsed.data);
    } catch (error) {
      // A 401 from the API is guidance, not a stack trace: put whatever it said
      // under the field it named, and keep a single line for the rest.
      setFieldErrors(fieldErrorsFromUnknown(error, LOGIN_FIELD_LABELS));
      setFormError(submitErrorMessage(error, LOGIN_FIELD_LABELS));
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
            <p className="muted">Sign in with your school account</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={(event) => void onSubmit(event)} noValidate>
          <Field
            id="school_id"
            label="School code"
            error={fieldErrors.school_id}
            hint="Enter your school's short code (for example, triumph-academy). A school UUID also works for existing accounts. Platform administrators leave this blank."
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
          <Field id="password" label="Password" error={fieldErrors.password}>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              value={password}
              error={Boolean(fieldErrors.password)}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {formError ? (
            <p className="field-error" role="alert">
              {formError}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={busy || status === 'loading'}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <Link href="/forgot-password" className="linkish" style={{ fontSize: '0.875rem' }}>
            Forgot password?
          </Link>
        </div>
        <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
          <Link href="/" className="linkish" style={{ fontSize: '0.875rem' }}>
            ← Back to homepage
          </Link>
        </div>
      </Card>
    </div>
  );
}

/**
 * `useSearchParams()` (read above for the post-reset flag) opts the route
 * into client-side rendering, which Next requires to sit inside a `Suspense`
 * boundary.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
