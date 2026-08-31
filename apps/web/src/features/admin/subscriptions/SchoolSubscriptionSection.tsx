'use client';

import React, { useCallback, useState } from 'react';
import { ApiClientError } from '@school-bus-tracking/api-client';
import {
  SUBSCRIPTION_STATUS_LABELS,
  type AdminPlanSummary,
  type AdminSchoolSubscriptionCreateRequest,
  type AdminSchoolSubscriptionHistoryItem,
  type AdminSchoolSubscriptionResponse,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../lib/errors';
import { formatCurrency, formatDateTime } from '../../../lib/format';
import { apiClient } from '../../../services/api';
import { AssignPlanDialog, type SubmitResult } from './AssignPlanDialog';
import { ChangePlanDialog } from './ChangePlanDialog';
import { billingPeriodSuffix, subscriptionStatusTone, subscriptionUiMode } from './helpers';

interface SectionData {
  subscription: AdminSchoolSubscriptionResponse;
  history: AdminSchoolSubscriptionHistoryItem[];
}

type DialogKind = 'assign' | 'change' | 'cancel' | null;

interface PlansState {
  items: AdminPlanSummary[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Subscription panel of `/admin/schools/[id]` (Task 42, step 2).
 *
 * Owns its own data so the rest of the school page never blocks on it:
 * the current subscription and the full history load in parallel with a
 * section-local skeleton. Mutations use the response body to update the
 * current-subscription state directly and refresh only the history list —
 * the page is never fully refetched. The active-plan catalog is fetched
 * lazily the first time a dialog opens and cached for the section's
 * lifetime. All business rules stay in the backend; a 409 (state changed
 * elsewhere / double cancel) resyncs the section instead of guessing.
 */
export const SchoolSubscriptionSection = React.memo(function SchoolSubscriptionSection({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<PlansState>({ items: null, loading: false, error: null });

  const { data, loading, error, reload, setData } = useLoad<SectionData>(async () => {
    // Independent requests — always issued in parallel.
    const [subscriptionEnvelope, historyEnvelope] = await Promise.all([
      apiClient.getSchoolSubscription(schoolId),
      apiClient.getSchoolSubscriptionHistory(schoolId),
    ]);
    return {
      subscription: unwrapEnvelope(subscriptionEnvelope),
      history: unwrapEnvelope(historyEnvelope).items,
    };
  }, [schoolId]);

  /** Lazily loads the assignable (active) plan catalog once per section life. */
  const ensurePlans = useCallback(async () => {
    setPlans((current) => {
      if (current.items || current.loading) return current;
      return { ...current, loading: true, error: null };
    });
    try {
      // The backend list already excludes retired plans via `status: 'active'`
      // — the inactive-plan rule is not re-implemented here.
      const envelope = await apiClient.listAdminPlans({
        status: 'active',
        limit: 100,
        sort: 'price',
        order: 'asc',
      });
      setPlans({ items: unwrapEnvelope(envelope).items, loading: false, error: null });
    } catch (caught) {
      setPlans({
        items: null,
        loading: false,
        error: getApiErrorMessage(caught, 'Could not load plans'),
      });
    }
  }, []);

  const openDialog = useCallback(
    (kind: Exclude<DialogKind, null>) => {
      setDialog(kind);
      if (kind !== 'cancel') void ensurePlans();
    },
    [ensurePlans],
  );

  /** Applies a mutation response locally and refreshes only the history list. */
  const applyMutation = useCallback(
    async (subscription: AdminSchoolSubscriptionResponse) => {
      setData((current) => ({ subscription, history: current?.history ?? [] }));
      try {
        const envelope = await apiClient.getSchoolSubscriptionHistory(schoolId);
        const items = unwrapEnvelope(envelope).items;
        setData((current) => (current ? { ...current, history: items } : current));
      } catch {
        // The subscription state is already correct; stale history is
        // recoverable via the section-level retry.
      }
    },
    [schoolId, setData],
  );

  const runMutation = useCallback(
    async (
      action: () => Promise<{ success: boolean; data?: AdminSchoolSubscriptionResponse }>,
      successMessage: string,
      failureMessage: string,
    ): Promise<SubmitResult> => {
      setBusy(true);
      try {
        const subscription = unwrapEnvelope(await action());
        await applyMutation(subscription);
        toast.push(successMessage, 'success');
        setDialog(null);
        return null;
      } catch (caught) {
        // Conflicts mean the server state moved (e.g. already cancelled or a
        // live subscription appeared) — resync instead of trusting local state.
        if (caught instanceof ApiClientError && caught.status === 409) {
          void reload();
        }
        return { message: getApiErrorMessage(caught, failureMessage), error: caught };
      } finally {
        setBusy(false);
      }
    },
    [applyMutation, reload, toast],
  );

  const submitAssign = useCallback(
    (body: AdminSchoolSubscriptionCreateRequest) =>
      runMutation(
        () => apiClient.createSchoolSubscription(schoolId, body),
        'Plan assigned',
        'Could not assign the plan',
      ),
    [runMutation, schoolId],
  );

  const submitChange = useCallback(
    (planId: string) =>
      runMutation(
        () => apiClient.updateSchoolSubscription(schoolId, { plan_id: planId }),
        'Plan changed — the previous subscription was kept as history',
        'Could not change the plan',
      ),
    [runMutation, schoolId],
  );

  const submitCancel = useCallback(async () => {
    setDialog(null);
    const result = await runMutation(
      () => apiClient.cancelSchoolSubscription(schoolId),
      'Subscription cancelled — the record is preserved in history',
      'Could not cancel the subscription',
    );
    if (result) toast.push(result.message, 'danger');
  }, [runMutation, schoolId, toast]);

  if (loading && !data) {
    return (
      <Card title="Subscription">
        <Skeleton lines={6} />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card title="Subscription">
        <ErrorState
          title="Could not load subscription"
          message={error ?? 'Unknown error'}
          onRetry={() => void reload()}
        />
      </Card>
    );
  }

  const { subscription, history } = data;
  const mode = subscriptionUiMode(subscription);
  const plan = subscription.plan;

  return (
    <>
      <Card
        title="Subscription"
        description="Commercial plan assigned to this tenant. No payment provider is connected in this phase — assignments, changes and cancellations never charge or refund anything."
      >
        {mode === 'assign' ? (
          <EmptyState
            title="No subscription"
            description="This school has never been assigned a plan. Assign one to put the tenant on a commercial tier."
            action={<Button onClick={() => openDialog('assign')}>Assign plan</Button>}
          />
        ) : (
          <>
            <div
              className="row"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '1rem' }}
            >
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Badge tone={subscriptionStatusTone(subscription.status)}>
                  {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
                </Badge>
                {plan ? (
                  <strong style={{ fontSize: '1.1rem' }}>
                    {plan.name}
                    {subscription.price && subscription.currency ? (
                      <span className="muted" style={{ fontWeight: 400 }}>
                        {' '}
                        · {formatCurrency(subscription.price, subscription.currency)}{' '}
                        {billingPeriodSuffix(subscription.billing_period)}
                      </span>
                    ) : null}
                  </strong>
                ) : null}
                {plan && !plan.is_active ? <Badge tone="warning">Plan retired</Badge> : null}
              </div>
              <div className="row">
                {mode === 'manage' ? (
                  <>
                    <Button variant="secondary" disabled={busy} onClick={() => openDialog('change')}>
                      Change plan
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => setDialog('cancel')}>
                      Cancel subscription
                    </Button>
                  </>
                ) : (
                  <Button disabled={busy} onClick={() => openDialog('assign')}>
                    Resubscribe
                  </Button>
                )}
              </div>
            </div>

            {mode === 'resubscribe' ? (
              <p className="muted" style={{ marginBottom: '1rem' }}>
                This school has no live subscription — the record below is{' '}
                {SUBSCRIPTION_STATUS_LABELS[subscription.status].toLowerCase()} and is kept for
                history. Resubscribing creates a brand-new subscription.
              </p>
            ) : null}

            <div className="grid grid-2" style={{ gap: '0.5rem 2rem' }}>
              <Detail label="Plan" value={plan?.name ?? null} />
              <Detail label="Plan code" value={plan?.code ?? null} mono />
              <Detail
                label="Price"
                value={
                  subscription.price && subscription.currency
                    ? `${formatCurrency(subscription.price, subscription.currency)} ${billingPeriodSuffix(subscription.billing_period)}`
                    : null
                }
              />
              <Detail label="Currency" value={subscription.currency} />
              <Detail label="Trial start" value={formatDateTime(subscription.trial_start)} />
              <Detail label="Trial end" value={formatDateTime(subscription.trial_end)} />
              <Detail
                label="Current period start"
                value={formatDateTime(subscription.current_period_start)}
              />
              <Detail
                label="Current period end"
                value={
                  subscription.current_period_end
                    ? formatDateTime(subscription.current_period_end)
                    : 'Open-ended (billing not configured)'
                }
              />
              <Detail label="Cancelled at" value={formatDateTime(subscription.cancelled_at)} />
              <Detail label="Last updated" value={formatDateTime(subscription.updated_at)} />
            </div>
          </>
        )}
      </Card>

      <Card
        title="Subscription history"
        description="Every subscription this school has ever had. Plan changes close the previous record instead of deleting it."
      >
        {history.length === 0 ? (
          <EmptyState
            title="No history"
            description="Assigned, changed and cancelled subscriptions will appear here."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Period</th>
                  <th>Trial</th>
                  <th>Cancelled</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.plan ? (
                        <>
                          {item.plan.name}
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            <code>{item.plan.code}</code> ·{' '}
                            {formatCurrency(item.plan.price, item.plan.currency)}{' '}
                            {billingPeriodSuffix(item.plan.billing_period)}
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                        <Badge tone={subscriptionStatusTone(item.status)}>
                          {SUBSCRIPTION_STATUS_LABELS[item.status]}
                        </Badge>
                        {item.is_current ? <Badge tone="info">Current</Badge> : null}
                      </div>
                    </td>
                    <td>
                      {formatDateTime(item.current_period_start)} →{' '}
                      {item.current_period_end ? formatDateTime(item.current_period_end) : 'open'}
                    </td>
                    <td>
                      {item.trial_start || item.trial_end
                        ? `${formatDateTime(item.trial_start)} → ${formatDateTime(item.trial_end)}`
                        : '—'}
                    </td>
                    <td>{formatDateTime(item.cancelled_at)}</td>
                    <td>{formatDateTime(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AssignPlanDialog
        open={dialog === 'assign'}
        mode={mode === 'resubscribe' ? 'resubscribe' : 'assign'}
        schoolName={schoolName}
        plans={plans.items}
        plansLoading={plans.loading}
        plansError={plans.error}
        onRetryPlans={() => void ensurePlans()}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={submitAssign}
      />

      <ChangePlanDialog
        open={dialog === 'change'}
        currentPlan={plan}
        plans={plans.items}
        plansLoading={plans.loading}
        plansError={plans.error}
        onRetryPlans={() => void ensurePlans()}
        busy={busy}
        onClose={() => setDialog(null)}
        onSubmit={submitChange}
      />

      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`Cancel the subscription of ${schoolName}?`}
        message={
          plan
            ? `The ${plan.name} subscription will be marked as cancelled immediately. The school keeps its data and the record is preserved in history — nothing is deleted. No refund or payment is processed: billing is not implemented in this phase.`
            : 'The subscription will be marked as cancelled immediately. The record is preserved in history and no refund or payment is processed: billing is not implemented in this phase.'
        }
        confirmLabel="Cancel subscription"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void submitCancel()}
      />
    </>
  );
});

const Detail: React.FC<{ label: string; value: string | null | undefined; mono?: boolean }> = ({
  label,
  value,
  mono = false,
}) => (
  <div>
    <div
      className="muted"
      style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
    >
      {label}
    </div>
    <div>{value && value !== '—' ? mono ? <code>{value}</code> : value : '—'}</div>
  </div>
);
