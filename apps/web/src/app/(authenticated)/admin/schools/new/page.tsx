'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { adminSchoolCreateSchema } from '@school-bus-tracking/validation';
import { Button, Card, Field, Input, PageHeader, useToast } from '../../../../../components/ui';
import { fieldErrorsFromUnknown, getApiErrorMessage, emptyToNull } from '../../../../../lib/errors';
import { apiClient } from '../../../../../services/api';

interface FormState {
  name: string;
  code: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  timezone: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  adminPhone: string;
}

const EMPTY: FormState = {
  name: '',
  code: '',
  email: '',
  phone: '',
  city: '',
  country: '',
  timezone: 'UTC',
  adminFirstName: '',
  adminLastName: '',
  adminEmail: '',
  adminPassword: '',
  adminPhone: '',
};

export default function NewSchoolPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const payload = {
      school: {
        name: form.name.trim(),
        code: form.code.trim().toLowerCase(),
        email: emptyToNull(form.email),
        phone: emptyToNull(form.phone),
        city: emptyToNull(form.city),
        country: emptyToNull(form.country?.toUpperCase()),
        timezone: form.timezone.trim() || 'UTC',
      },
      admin: {
        first_name: form.adminFirstName.trim(),
        last_name: form.adminLastName.trim(),
        email: form.adminEmail.trim(),
        password: form.adminPassword,
        phone: emptyToNull(form.adminPhone),
      },
    };

    const parsed = adminSchoolCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(
        flattenNestedErrors(
          parsed.error.flatten() as { fieldErrors: Record<string, string[] | undefined> },
        ),
      );
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const envelope = await apiClient.createAdminSchool(parsed.data);
      const school = envelope.data?.school;
      toast.push(`School ${school?.name ?? 'created'} provisioned successfully`, 'success');
      if (school) {
        router.push(`/admin/schools/${school.id}`);
      } else {
        router.push('/admin/schools');
      }
    } catch (error) {
      const nested = fieldErrorsFromUnknown(error);
      if (Object.keys(nested).length > 0) {
        setFieldErrors(nested);
      }
      setFormError(getApiErrorMessage(error, 'Could not create school'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Add school"
        description="Provision a new customer tenant together with its first school administrator."
      />

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Card
          title="School information"
          description="Tenant identity and contact details. The code is the stable, platform-wide identifier."
        >
          <div className="grid grid-2">
            <Field id="name" label="School name" error={fieldErrors['school.name']}>
              <Input
                id="name"
                value={form.name}
                onChange={set('name')}
                error={Boolean(fieldErrors['school.name'])}
                placeholder="Lincoln High School"
              />
            </Field>
            <Field
              id="code"
              label="School code"
              error={fieldErrors['school.code']}
              hint="Lowercase letters, numbers and hyphens. Cannot change later."
            >
              <Input
                id="code"
                value={form.code}
                onChange={set('code')}
                error={Boolean(fieldErrors['school.code'])}
                placeholder="lincoln-high"
              />
            </Field>
            <Field id="email" label="Contact email" error={fieldErrors['school.email']}>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={set('email')}
                error={Boolean(fieldErrors['school.email'])}
                placeholder="office@school.edu"
              />
            </Field>
            <Field id="phone" label="Phone" error={fieldErrors['school.phone']}>
              <Input
                id="phone"
                value={form.phone}
                onChange={set('phone')}
                error={Boolean(fieldErrors['school.phone'])}
                placeholder="+1-555-0100"
              />
            </Field>
            <Field id="city" label="City" error={fieldErrors['school.city']}>
              <Input
                id="city"
                value={form.city}
                onChange={set('city')}
                error={Boolean(fieldErrors['school.city'])}
              />
            </Field>
            <Field
              id="country"
              label="Country (ISO 2-letter)"
              error={fieldErrors['school.country']}
            >
              <Input
                id="country"
                value={form.country}
                onChange={set('country')}
                error={Boolean(fieldErrors['school.country'])}
                placeholder="US"
                maxLength={2}
              />
            </Field>
            <Field
              id="timezone"
              label="Timezone"
              error={fieldErrors['school.timezone']}
              hint="IANA timezone, e.g. America/Chicago."
            >
              <Input
                id="timezone"
                value={form.timezone}
                onChange={set('timezone')}
                error={Boolean(fieldErrors['school.timezone'])}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Initial school administrator"
          description="This account can sign in immediately and manage the tenant's students, staff and operations."
        >
          <div className="grid grid-2">
            <Field id="adminFirstName" label="First name" error={fieldErrors['admin.first_name']}>
              <Input
                id="adminFirstName"
                value={form.adminFirstName}
                onChange={set('adminFirstName')}
                error={Boolean(fieldErrors['admin.first_name'])}
              />
            </Field>
            <Field id="adminLastName" label="Last name" error={fieldErrors['admin.last_name']}>
              <Input
                id="adminLastName"
                value={form.adminLastName}
                onChange={set('adminLastName')}
                error={Boolean(fieldErrors['admin.last_name'])}
              />
            </Field>
            <Field
              id="adminEmail"
              label="Admin email"
              error={fieldErrors['admin.email']}
              hint="Unique within this school."
            >
              <Input
                id="adminEmail"
                type="email"
                value={form.adminEmail}
                onChange={set('adminEmail')}
                error={Boolean(fieldErrors['admin.email'])}
                placeholder="admin@school.edu"
              />
            </Field>
            <Field id="adminPhone" label="Admin phone" error={fieldErrors['admin.phone']}>
              <Input
                id="adminPhone"
                value={form.adminPhone}
                onChange={set('adminPhone')}
                error={Boolean(fieldErrors['admin.phone'])}
              />
            </Field>
            <Field
              id="adminPassword"
              label="Temporary password"
              error={fieldErrors['admin.password']}
              hint="Minimum 8 characters. Share it securely; it is never shown again."
            >
              <Input
                id="adminPassword"
                type="password"
                autoComplete="new-password"
                value={form.adminPassword}
                onChange={set('adminPassword')}
                error={Boolean(fieldErrors['admin.password'])}
              />
            </Field>
          </div>
        </Card>

        {formError ? (
          <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>
            {formError}
          </p>
        ) : null}

        <div className="row">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Provisioning…' : 'Create school'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => router.push('/admin/schools')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Zod field errors for nested objects arrive keyed as `school.name`. */
function flattenNestedErrors(error: {
  fieldErrors: Record<string, string[] | undefined>;
}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (messages && messages.length > 0) {
      result[key] = messages[0];
    }
  }
  return result;
}
