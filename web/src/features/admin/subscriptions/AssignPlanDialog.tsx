'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES,
  SUBSCRIPTION_STATUS_LABELS,
  type AdminPlanSummary,
  type AdminSchoolSubscriptionCreateRequest,
} from '@school-bus-tracking/shared-types';
import { adminSchoolSubscriptionCreateSchema } from '@school-bus-tracking/validation';
import { Button, Field, Input, Modal, Select, Spinner } from '../../../components/ui';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  formErrorsFromZod,
} from '../../../lib/errors';
import { formatCurrency } from '../../../lib/format';
import {
  billingPeriodSuffix,
  EMPTY_ASSIGN_FORM,
  toAssignSubscriptionRequest,
  type AssignPlanFormState,
} from './helpers';

/** `null` on success; otherwise a user-readable message plus the raw error. */
export type SubmitResult = null | { message: string; error?: unknown };

/**
 * Assign / Resubscribe dialog.
 *
 * Client-side validation runs the *shared* zod schema for fast feedback only
 * — the backend re-validates everything and remains authoritative (plan
 * existence/activation, one live subscription, date rules). Only backend-
 * assignable statuses are offered; `none` is never sent.
 */
export const AssignPlanDialog: React.FC<{
  open: boolean;
  mode: 'assign' | 'resubscribe';
  schoolName: string;
  plans: AdminPlanSummary[] | null;
  plansLoading: boolean;
  plansError: string | null;
  onRetryPlans: () => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: AdminSchoolSubscriptionCreateRequest) => Promise<SubmitResult>;
}> = ({
  open,
  mode,
  schoolName,
  plans,
  plansLoading,
  plansError,
  onRetryPlans,
  busy,
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState<AssignPlanFormState>(EMPTY_ASSIGN_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_ASSIGN_FORM);
      setFieldErrors({});
      setFormError(null);
    }
  }, [open]);

  const setField = useCallback((key: keyof AssignPlanFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError(null);
      if (!form.plan_id) {
        setFieldErrors({ plan_id: 'Select a plan' });
        return;
      }
      const body = toAssignSubscriptionRequest(form);
      const parsed = adminSchoolSubscriptionCreateSchema.safeParse(body);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        const formLevel = formErrorsFromZod(parsed.error);
        if (formLevel.length > 0) setFormError(formLevel.join(' '));
        return;
      }
      setFieldErrors({});
      const result = await onSubmit(body);
      if (result) {
        setFormError(result.message);
        setFieldErrors(fieldErrorsFromUnknown(result.error));
      }
    },
    [form, onSubmit],
  );

  const selectedPlan = plans?.find((plan) => plan.id === form.plan_id) ?? null;

  return (
    <Modal
      title={mode === 'resubscribe' ? `Resubscribe ${schoolName}` : `Assign a plan to ${schoolName}`}
      description={
        mode === 'resubscribe'
          ? 'A brand-new subscription is created; the previous record stays in history. No payment is processed.'
          : 'Attach this school to a commercial plan. No payment is processed in this phase.'
      }
      open={open}
      onClose={busy ? () => undefined : onClose}
    >
      {plansLoading ? (
        <Spinner label="Loading plans" />
      ) : plansError ? (
        <div>
          <p className="muted">{plansError}</p>
          <Button variant="secondary" onClick={onRetryPlans}>
            Try again
          </Button>
        </div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <Field
            id="subscription-plan"
            label="Plan"
            hint="Only active plans can be assigned."
            error={fieldErrors.plan_id}
          >
            <Select
              id="subscription-plan"
              value={form.plan_id}
              placeholder={plans && plans.length > 0 ? 'Select a plan…' : 'No active plans'}
              disabled={!plans || plans.length === 0 || busy}
              onChange={(event) => setField('plan_id', event.target.value)}
              options={(plans ?? []).map((plan) => ({
                value: plan.id,
                label: `${plan.name} — ${formatCurrency(plan.price, plan.currency)} ${billingPeriodSuffix(plan.billing_period)}`,
              }))}
            />
          </Field>

          {selectedPlan ? (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.25rem' }}>
              <code>{selectedPlan.code}</code>
              {selectedPlan.feature_summary.length > 0
                ? ` · ${selectedPlan.feature_summary.slice(0, 4).join(', ')}${selectedPlan.feature_summary.length > 4 ? '…' : ''}`
                : null}
              {selectedPlan.limit_summary.length > 0
                ? ` · ${selectedPlan.limit_summary
                    .slice(0, 3)
                    .map((limit) => `${limit.label}: ${limit.display}`)
                    .join(', ')}`
                : null}
            </p>
          ) : null}

          <Field
            id="subscription-status"
            label="Status"
            hint="Trialing requires a trial end date."
            error={fieldErrors.status}
          >
            <Select
              id="subscription-status"
              value={form.status}
              disabled={busy}
              onChange={(event) => setField('status', event.target.value)}
              options={ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES.map((status) => ({
                value: status,
                label: SUBSCRIPTION_STATUS_LABELS[status],
              }))}
            />
          </Field>

          <div className="grid grid-2" style={{ gap: '0 1rem' }}>
            <Field
              id="subscription-trial-start"
              label="Trial start (optional)"
              error={fieldErrors.trial_start}
            >
              <Input
                id="subscription-trial-start"
                type="datetime-local"
                value={form.trial_start}
                disabled={busy}
                error={Boolean(fieldErrors.trial_start)}
                onChange={(event) => setField('trial_start', event.target.value)}
              />
            </Field>
            <Field
              id="subscription-trial-end"
              label="Trial end (optional)"
              error={fieldErrors.trial_end}
            >
              <Input
                id="subscription-trial-end"
                type="datetime-local"
                value={form.trial_end}
                disabled={busy}
                error={Boolean(fieldErrors.trial_end)}
                onChange={(event) => setField('trial_end', event.target.value)}
              />
            </Field>
            <Field
              id="subscription-period-start"
              label="Period start (optional)"
              hint="Defaults to now."
              error={fieldErrors.current_period_start}
            >
              <Input
                id="subscription-period-start"
                type="datetime-local"
                value={form.current_period_start}
                disabled={busy}
                error={Boolean(fieldErrors.current_period_start)}
                onChange={(event) => setField('current_period_start', event.target.value)}
              />
            </Field>
            <Field
              id="subscription-period-end"
              label="Period end (optional)"
              hint="Leave empty for open-ended — billing is not implemented yet."
              error={fieldErrors.current_period_end}
            >
              <Input
                id="subscription-period-end"
                type="datetime-local"
                value={form.current_period_end}
                disabled={busy}
                error={Boolean(fieldErrors.current_period_end)}
                onChange={(event) => setField('current_period_end', event.target.value)}
              />
            </Field>
          </div>

          {formError ? (
            <p className="field-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !plans || plans.length === 0}>
              {busy ? 'Assigning…' : mode === 'resubscribe' ? 'Resubscribe' : 'Assign plan'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
