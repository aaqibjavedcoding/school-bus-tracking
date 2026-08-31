'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CheckboxRow,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  LimitRow,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../../../../../components/ui';
import { useLoad } from '../../../../../hooks/useLoad';
import { formatCurrency, formatDateTime } from '../../../../../lib/format';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../../lib/errors';
import { apiClient } from '../../../../../services/api';
import {
  PlanBillingPeriod,
  PlanFeature,
  PlanLimitResource,
  PLAN_FEATURE_LABELS,
  PLAN_LIMIT_RESOURCE_LABELS,
  type AdminPlanResponse,
} from '@school-bus-tracking/shared-types';
import { adminPlanUpdateSchema } from '@school-bus-tracking/validation';

interface LimitInput {
  unlimited: boolean;
  value: string;
}

interface FormState {
  name: string;
  description: string;
  price: string;
  currency: string;
  billing_period: PlanBillingPeriod;
  is_active: boolean;
  features: Record<string, boolean>;
  limits: Record<string, LimitInput>;
}

const PLAN_FEATURE_LIST: PlanFeature[] = Object.values(PlanFeature);
const PLAN_LIMIT_LIST: PlanLimitResource[] = Object.values(PlanLimitResource);

const BILLING_LABELS: Record<string, string> = {
  monthly: '/ month',
  yearly: '/ year',
};

function planToForm(plan: AdminPlanResponse): FormState {
  const features: Record<string, boolean> = {};
  for (const key of PLAN_FEATURE_LIST) {
    features[key] = Boolean(plan.features[key]);
  }
  const limits: Record<string, LimitInput> = {};
  for (const key of PLAN_LIMIT_LIST) {
    const entry = plan.limits[key];
    limits[key] = entry
      ? { unlimited: entry.unlimited, value: entry.unlimited ? '' : String(entry.value ?? '') }
      : { unlimited: false, value: '' };
  }
  return {
    name: plan.name,
    description: plan.description ?? '',
    price: String(plan.price),
    currency: plan.currency,
    billing_period: plan.billing_period,
    is_active: plan.is_active,
    features,
    limits,
  };
}

export default function PlanDetailPage({ params }: { params: { id: string } }) {
  const planId = params.id;
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<null | 'save' | 'activate' | 'deactivate'>(null);
  const [confirm, setConfirm] = useState<'activate' | 'deactivate' | null>(null);

  const {
    data: plan,
    loading,
    error,
    reload,
    setData,
  } = useLoad(async () => {
    const envelope = await apiClient.getAdminPlan(planId);
    const loaded = unwrapEnvelope(envelope);
    setForm(planToForm(loaded));
    return loaded;
  }, [planId]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
  };

  const setFeature = (key: string, enabled: boolean) =>
    setForm((current) =>
      current ? { ...current, features: { ...current.features, [key]: enabled } } : current,
    );

  const setLimit = (key: string, patch: Partial<LimitInput>) =>
    setForm((current) =>
      current
        ? { ...current, limits: { ...current.limits, [key]: { ...current.limits[key], ...patch } } }
        : current,
    );

  if (loading && !plan) {
    return (
      <div className="page">
        <PageHeader title="Plan details" />
        <Skeleton lines={14} />
      </div>
    );
  }

  if (error || !plan || !form) {
    return (
      <div className="page">
        <PageHeader title="Plan details" />
        <ErrorState message={error ?? 'Unable to load plan'} onRetry={() => void reload()} />
      </div>
    );
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const features: Record<string, boolean> = {};
    for (const [key, on] of Object.entries(form.features)) {
      if (on) features[key] = true;
    }

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
      name: form.name.trim(),
      description: emptyToNull(form.description),
      price: Number(form.price),
      currency: form.currency.trim().toUpperCase(),
      billing_period: form.billing_period,
      is_active: form.is_active,
      features,
      limits,
    };

    const parsed = adminPlanUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      const objectErrors = formErrorsFromZod(parsed.error);
      setFormError(
        objectErrors.length > 0
          ? objectErrors.join(' ')
          : 'Please fix the highlighted fields and try again.',
      );
      return;
    }

    setFieldErrors({});
    setBusyAction('save');
    setBusy(true);
    try {
      const envelope = await apiClient.updateAdminPlan(planId, parsed.data);
      const updated = unwrapEnvelope(envelope);
      setData(updated);
      setForm(planToForm(updated));
      toast.push('Plan updated', 'success');
    } catch (caught) {
      const nested = fieldErrorsFromUnknown(caught);
      if (Object.keys(nested).length > 0) setFieldErrors(nested);
      setFormError(getApiErrorMessage(caught, 'Could not update plan'));
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  };

  const runLifecycle = async (action: 'activate' | 'deactivate') => {
    setBusyAction(action);
    try {
      if (action === 'activate') {
        await apiClient.activateAdminPlan(planId);
        toast.push('Plan activated', 'success');
      } else {
        await apiClient.deactivateAdminPlan(planId);
        toast.push('Plan deactivated', 'info');
      }
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught, 'Lifecycle action failed'), 'danger');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={plan.name}
        description={`Code: ${plan.code}`}
        actions={
          <div className="row">
            <Badge tone={plan.is_active ? 'success' : 'warning'}>
              {plan.is_active ? 'Active' : 'Inactive'}
            </Badge>
            <Button variant="secondary" onClick={() => router.push('/admin/plans')}>
              Back
            </Button>
            {plan.is_active ? (
              <Button
                variant="danger"
                disabled={busy || busyAction !== null}
                onClick={() => setConfirm('deactivate')}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="success"
                disabled={busy || busyAction !== null}
                onClick={() => setConfirm('activate')}
              >
                Activate
              </Button>
            )}
          </div>
        }
      />

      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        <strong style={{ fontSize: '1.4rem' }}>
          {formatCurrency(Number(plan.price), plan.currency)}
        </strong>
        <span> {BILLING_LABELS[plan.billing_period] ?? plan.billing_period}</span>
        <span style={{ marginLeft: '0.75rem' }}>Updated {formatDateTime(plan.updated_at)}</span>
      </p>

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Card title="Plan identity" description="Plan name, description and pricing.">
          <div className="grid grid-2">
            <Field id="name" label="Name" error={fieldErrors.name}>
              <Input
                id="name"
                value={form.name}
                onChange={(event) => updateForm({ name: event.target.value })}
                error={Boolean(fieldErrors.name)}
              />
            </Field>
            <Field id="code" label="Code" hint="Identifiers cannot be changed.">
              <Input id="code" value={plan.code} disabled />
            </Field>
            <Field id="description" label="Description" error={fieldErrors.description}>
              <Input
                id="description"
                value={form.description}
                onChange={(event) => updateForm({ description: event.target.value })}
                error={Boolean(fieldErrors.description)}
              />
            </Field>
            <Field id="price" label="Price" error={fieldErrors.price}>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => updateForm({ price: event.target.value })}
                error={Boolean(fieldErrors.price)}
              />
            </Field>
            <Field id="currency" label="Currency (ISO 4217)" error={fieldErrors.currency}>
              <Input
                id="currency"
                value={form.currency}
                onChange={(event) => updateForm({ currency: event.target.value })}
                error={Boolean(fieldErrors.currency)}
                maxLength={3}
              />
            </Field>
            <Field id="billing_period" label="Billing period" error={fieldErrors.billing_period}>
              <Select
                id="billing_period"
                value={form.billing_period}
                onChange={(event) =>
                  updateForm({ billing_period: event.target.value as PlanBillingPeriod })
                }
                options={[
                  { value: PlanBillingPeriod.MONTHLY, label: 'Monthly' },
                  { value: PlanBillingPeriod.YEARLY, label: 'Yearly' },
                ]}
              />
            </Field>
          </div>
        </Card>

        <Card title="Features" description="Toggle the capabilities included with this plan.">
          <div className="grid grid-2" style={{ gap: '0.5rem' }}>
            {PLAN_FEATURE_LIST.map((feature) => (
              <CheckboxRow
                key={feature}
                id={`feature-${feature}`}
                label={PLAN_FEATURE_LABELS[feature]}
                checked={Boolean(form.features[feature])}
                onChange={(checked) => setFeature(feature, checked)}
              />
            ))}
          </div>
        </Card>

        <Card title="Resource limits" description="Maximum resources a school can provision on this plan.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {PLAN_LIMIT_LIST.map((resource) => {
              const entry = form.limits[resource] ?? { unlimited: false, value: '' };
              return (
                <LimitRow
                  key={resource}
                  id={`limit-${resource}`}
                  label={PLAN_LIMIT_RESOURCE_LABELS[resource]}
                  unlimited={entry.unlimited}
                  value={entry.value}
                  error={fieldErrors[`limits.${resource}`] || fieldErrors[`limits.${resource}.value`]}
                  onUnlimitedChange={(checked) => setLimit(resource, { unlimited: checked })}
                  onValueChange={(value) => setLimit(resource, { value })}
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
          <Button type="submit" size="lg" disabled={busy || busyAction !== null}>
            {busy && busyAction === 'save' ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => router.push('/admin/plans')}
          >
            Back to plans
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'deactivate' ? `Deactivate ${plan.name}?` : `Activate ${plan.name}?`}
        message={
          confirm === 'deactivate'
            ? 'Schools already on this plan keep access, but the plan will be hidden from new subscription flows.'
            : 'The plan will become available for new school subscriptions.'
        }
        confirmLabel={confirm === 'deactivate' ? 'Deactivate plan' : 'Activate plan'}
        danger={confirm === 'deactivate'}
        busy={busyAction === confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void runLifecycle(confirm);
          setConfirm(null);
        }}
      />
    </div>
  );
}
