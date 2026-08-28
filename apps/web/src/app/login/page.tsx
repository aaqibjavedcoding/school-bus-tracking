'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { loginSchema } from '@school-bus-tracking/validation';
import { Button, Card, Field, Input } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthProvider';
import { fieldErrorsFromZod, getApiErrorMessage } from '../../lib/errors';
import { homePath } from '../../lib/roles';

export default function LoginPage() {
  const { login, status, user } = useAuth();
  const router = useRouter();
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
            label="School ID"
            error={fieldErrors.school_id}
            hint="The school UUID from your administrator. Platform administrators sign in with this left blank."
          >
            <Input
              id="school_id"
              name="school_id"
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
            <Input
              id="password"
              name="password"
              type="password"
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
      </Card>
    </div>
  );
}
