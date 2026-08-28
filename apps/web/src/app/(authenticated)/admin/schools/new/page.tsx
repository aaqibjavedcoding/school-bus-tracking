'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { adminSchoolCreateSchema } from '@school-bus-tracking/validation';
import { Button, Card, Field, Input, PageHeader, useToast } from '../../../../../components/ui';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
  emptyToNull,
} from '../../../../../lib/errors';
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

/**
 * Schema path → DOM id, in the order the fields appear on the page.
 *
 * Used to move focus (and therefore the scroll position) to the first field
 * that failed validation, so a rejected submit is impossible to miss even
 * when the offending field is above the fold.
 */
const FIELD_IDS: ReadonlyArray<readonly [path: string, id: string]> = [
  ['school.name', 'name'],
  ['school.code', 'code'],
  ['school.email', 'email'],
  ['school.phone', 'phone'],
  ['school.city', 'city'],
  ['school.country', 'country'],
  ['school.timezone', 'timezone'],
  ['admin.first_name', 'adminFirstName'],
  ['admin.last_name', 'adminLastName'],
  ['admin.email', 'adminEmail'],
  ['admin.phone', 'adminPhone'],
  ['admin.password', 'adminPassword'],
];

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
      // Map every issue by its full path (`school.code`, `admin.password`) so
      // the message lands next to the field the user has to fix.
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      // Never fail silently: always explain why nothing was submitted, even
      // for object-level issues that belong to no single field.
      const objectErrors = formErrorsFromZod(parsed.error);
      setFormError(
        objectErrors.length > 0
          ? objectErrors.join(' ')
          : 'Please fix the highlighted fields and try again.',
      );
      focusFirstInvalidField(errors);
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

/**
 * Moves focus to the first invalid field in visual order.
 *
 * The error state is applied after this handler returns, so the lookup waits
 * one animation frame — the highlighted input exists in the DOM by then and
 * focusing it also scrolls it into view.
 */
function focusFirstInvalidField(errors: Record<string, string>): void {
  const target = FIELD_IDS.find(([path]) => errors[path]);
  if (!target) {
    return;
  }
  window.requestAnimationFrame(() => {
    document.getElementById(target[1])?.focus();
  });
}
