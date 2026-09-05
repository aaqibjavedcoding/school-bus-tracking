'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { loginSchema } from '@school-bus-tracking/validation';
import { Button, Card, Field, Input } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthProvider';
import { fieldErrorsFromZod, getApiErrorMessage } from '../../lib/errors';
import { homePath } from '../../lib/roles';

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, status, user } = useAuth();
  const router = useRouter();
  const [schoolId, setSchoolId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      router.replace(homePath(user.role));
    }
  }, [status, user, router]);

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
      setFormError(getApiErrorMessage(error, 'Could not sign in'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <Card className="login-card">
        <div className="row" style={{ marginBottom: '1rem' }}>
          <span className="brand-mark">SBT</span>
          <div>
            <h1 style={{ fontSize: '1.2rem' }}>School Bus Tracking</h1>
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
            <div className="password-input-wrapper">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                error={Boolean(fieldErrors.password)}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="password-toggle-btn"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
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
      </Card>
    </div>
  );
}
