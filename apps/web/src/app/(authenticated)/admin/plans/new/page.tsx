'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import {
  PlanBillingPeriod,
  PlanFeature,
  PlanLimitResource,
  PLAN_FEATURE_LABELS,
  PLAN_LIMIT_RESOURCE_LABELS,
} from '@school-bus-tracking/shared-types';
import {
  Button,
  Card,
  CheckboxRow,
  Field,
  Input,
  LimitRow,
  PageHeader,
  Select,
  useToast,
} from '../../../../../components/ui';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
} from '../../../../../lib/errors';
import { apiClient } from '../../../../../services/api';
import { adminPlanCreateSchema } from '@school-bus-tracking/validation';

interface LimitInput {
  unlimited: boolean;
  value: string;
}

interface FormState {
  code: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  billing_period: PlanBillingPeriod;
  is_active: boolean;
  features: Record<PlanFeature, boolean>;
  limits: Record<PlanLimitResource, LimitInput>;
}

const PLAN_FEATURE_LIST: PlanFeature[] = Object.values(PlanFeature);
const PLAN_LIMIT_LIST: PlanLimitResource[] = Object.values(PlanLimitResource);

function defaultFeatures(): Record<PlanFeature, boolean> {
  return PLAN_FEATURE_LIST.reduce(
    (acc, key) => {
      acc[key] = false;
      return acc;
    },
    {} as Record<PlanFeature, boolean>,
  );
}

function defaultLimits(): Record<PlanLimitResource, LimitInput> {
  return PLAN_LIMIT_LIST.reduce(
    (acc, key) => {
      acc[key] = { unlimited: false, value: '' };
      return acc;
    },
    {} as Record<PlanLimitResource, LimitInput>,
  );
}

const EMPTY: FormState = {
  code: '',
  name: '',
  description: '',
  price: '',
  currency: 'USD',
  billing_period: PlanBillingPeriod.MONTHLY,
  is_active: true,
  features: defaultFeatures(),
  limits: defaultLimits(),
};

const FIELD_IDS: ReadonlyArray<readonly [path: string, id: string]> = [
  ['code', 'code'],
  ['name', 'name'],
  ['description', 'description'],
  ['price', 'price'],
  ['currency', 'currency'],
  ['billing_period', 'billing_period'],
];

export default function NewPlanPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const setFeature = (key: PlanFeature, enabled: boolean) =>
    setForm((current) => ({ ...current, features: { ...current.features, [key]: enabled } }));

  const setLimit = (key: PlanLimitResource, patch: Partial<LimitInput>) =>
    setForm((current) => ({
      ...current,
      limits: { ...current.limits, [key]: { ...current.limits[key], ...patch } },
    }));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const features = Object.fromEntries(
      Object.entries(form.features).filter(([, on]) => on),
    ) as Record<string, boolean>;

    const limits: Record<string, { unlimited: boolean; value: number | null }> = {};
    for (const [key, entry] of Object.entries(form.limits)) {
      if (entry.unlimited) {
        limits[key] = { unlimited: true, value: null };
      } else if (entry.value.trim() !== '') {
        const n = Number(entry.value);
        limits[key] = { unlimited: false, value: Number.isFinite(n) ? Math.floor(n) : 0 };
      }
    }

    const payload = {
      code: form.code.trim().toLowerCase(),
      name: form.name.trim(),
      description: emptyToNull(form.description),
      price: Number(form.price),
      currency: form.currency.trim().toUpperCase(),
      billing_period: form.billing_period,
      is_active: form.is_active,
      features,
      limits,
    };

    const parsed = adminPlanCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
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
      const envelope = await apiClient.createAdminPlan(parsed.data);
      toast.push(`Plan ${envelope.data?.name ?? 'created'} created.`, 'success');
      if (envelope.data) {
        router.push(`/admin/plans/${envelope.data.id}`);
      } else {
        router.push('/admin/plans');
      }
    } catch (error) {
      const nested = fieldErrorsFromUnknown(error);
      if (Object.keys(nested).length > 0) {
        setFieldErrors(nested);
      }
      setFormError(getApiErrorMessage(error, 'Could not create plan'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Create plan"
        description="Define a new commercial tier: pricing, billing cadence, enabled features and resource limits."
      />

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Card title="Plan identity" description="Basic information shown to school buyers.">
          <div className="grid grid-2">
            <Field id="name" label="Name" error={fieldErrors.name}>
              <Input
                id="name"
                value={form.name}
                onChange={set('name')}
                error={Boolean(fieldErrors.name)}
                placeholder="Basic"
              />
            </Field>
            <Field
              id="code"
              label="Code"
              error={fieldErrors.code}
              hint="Lowercase letters, numbers and hyphens. Cannot change later."
            >
              <Input
                id="code"
                value={form.code}
                onChange={set('code')}
                error={Boolean(fieldErrors.code)}
                placeholder="basic"
              />
            </Field>
            <Field id="description" label="Description" error={fieldErrors.description}>
              <Input
                id="description"
                value={form.description}
                onChange={set('description')}
                error={Boolean(fieldErrors.description)}
                placeholder="Starter tier for small schools"
              />
            </Field>
          </div>
        </Card>

        <Card title="Pricing & billing" description="Commercial terms of the tier.">
          <div className="grid grid-2">
            <Field id="price" label="Price" error={fieldErrors.price} hint="Per billing period.">
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={set('price')}
                error={Boolean(fieldErrors.price)}
                placeholder="19.99"
              />
            </Field>
            <Field id="currency" label="Currency (ISO 4217)" error={fieldErrors.currency}>
              <Input
                id="currency"
                value={form.currency}
                onChange={set('currency')}
                error={Boolean(fieldErrors.currency)}
                placeholder="USD"
                maxLength={3}
              />
            </Field>
            <Field id="billing_period" label="Billing period" error={fieldErrors.billing_period}>
              <Select
                id="billing_period"
                value={form.billing_period}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    billing_period: event.target.value as PlanBillingPeriod,
                  }))
                }
                options={[
                  { value: PlanBillingPeriod.MONTHLY, label: 'Monthly' },
                  { value: PlanBillingPeriod.YEARLY, label: 'Yearly' },
                ]}
              />
            </Field>
            <Field id="is_active" label="Activation" hint="Inactive plans are hidden from new subscriptions.">
              <Select
                id="is_active"
                value={form.is_active ? 'true' : 'false'}
                onChange={(event) =>
                  setForm((current) => ({ ...current, is_active: event.target.value === 'true' }))
                }
                options={[
                  { value: 'true', label: 'Active (available now)' },
                  { value: 'false', label: 'Inactive (draft)' },
                ]}
              />
            </Field>
          </div>
        </Card>

        <Card title="Features" description="Capabilities enabled for schools on this plan.">
          <div className="grid grid-2" style={{ gap: '0.5rem' }}>
            {PLAN_FEATURE_LIST.map((feature) => (
              <CheckboxRow
                key={feature}
                id={`feature-${feature}`}
                label={PLAN_FEATURE_LABELS[feature]}
                checked={form.features[feature]}
                onChange={(checked) => setFeature(feature, checked)}
              />
            ))}
          </div>
        </Card>

        <Card title="Resource limits" description="Maximum resources per school. Check Unlimited for plans with no cap.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {PLAN_LIMIT_LIST.map((resource) => {
              const entry = form.limits[resource];
              return (
                <LimitRow
                  key={resource}
                  id={`limit-${resource}`}
                  label={PLAN_LIMIT_RESOURCE_LABELS[resource]}
                  unlimited={entry.unlimited}
                  value={entry.value}
                  onUnlimitedChange={(checked) => setLimit(resource, { unlimited: checked })}
                  onValueChange={(value) => setLimit(resource, { value })}
                  error={fieldErrors[`limits.${resource}`] || fieldErrors[`limits.${resource}.value`]}
                />
              );
            })}
          </div>
        </Card>

        {formError ? (
          <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>
            {formError}
          </p>
        ) : null}

        <div className="row">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Creating…' : 'Create plan'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => router.push('/admin/plans')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function focusFirstInvalidField(errors: Record<string, string>): void {
  const target = FIELD_IDS.find(([path]) => errors[path]);
  if (!target) return;
  window.requestAnimationFrame(() => {
    document.getElementById(target[1])?.focus();
  });
}
