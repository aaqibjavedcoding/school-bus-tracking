'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { AdminPlanResponse, AdminPlanSummary } from '@school-bus-tracking/shared-types';
import { Badge, Button, Modal, Spinner } from '../../../components/ui';
import { formatCurrency } from '../../../lib/format';
import { billingPeriodSuffix } from './helpers';
import type { SubmitResult } from './AssignPlanDialog';

/**
 * Change / upgrade / downgrade dialog for a live subscription.
 *
 * Two steps inside one modal: pick a plan (current plan clearly marked and
 * not selectable), then an explicit confirmation explaining that the backend
 * closes the existing subscription as history and opens a new one — the
 * frontend never re-implements that logic.
 */
export const ChangePlanDialog: React.FC<{
  open: boolean;
  currentPlan: AdminPlanResponse | null;
  plans: AdminPlanSummary[] | null;
  plansLoading: boolean;
  plansError: string | null;
  onRetryPlans: () => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (planId: string) => Promise<SubmitResult>;
}> = ({
  open,
  currentPlan,
  plans,
  plansLoading,
  plansError,
  onRetryPlans,
  busy,
  onClose,
  onSubmit,
}) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedId('');
      setConfirming(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    setError(null);
    const result = await onSubmit(selectedId);
    if (result) {
      setError(result.message);
      setConfirming(false);
    }
  }, [onSubmit, selectedId]);

  const selectedPlan = plans?.find((plan) => plan.id === selectedId) ?? null;

  return (
    <Modal
      title="Change plan"
      description={
        currentPlan
          ? `Currently on ${currentPlan.name} (${formatCurrency(currentPlan.price, currentPlan.currency)} ${billingPeriodSuffix(currentPlan.billing_period)}).`
          : 'Select the new plan for this school.'
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
      ) : confirming && selectedPlan ? (
        <>
          <p>
            Change {currentPlan ? <strong>{currentPlan.name}</strong> : 'the current plan'} to{' '}
            <strong>{selectedPlan.name}</strong> (
            {formatCurrency(selectedPlan.price, selectedPlan.currency)}{' '}
            {billingPeriodSuffix(selectedPlan.billing_period)})?
          </p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            The existing subscription is closed and preserved in history, and a new subscription
            starts on the selected plan immediately. No payment or refund is processed — billing is
            not implemented in this phase.
          </p>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={busy}>
              {busy ? 'Changing…' : `Change to ${selectedPlan.name}`}
            </Button>
          </div>
        </>
      ) : (
        <>
          {!plans || plans.length === 0 ? (
            <p className="muted">No active plans are available to switch to.</p>
          ) : (
            <div role="radiogroup" aria-label="Available plans">
              {plans.map((plan) => {
                const isCurrent = plan.id === currentPlan?.id;
                return (
                  <label
                    key={plan.id}
                    className="checkbox-row"
                    style={{
                      alignItems: 'flex-start',
                      opacity: isCurrent ? 0.6 : 1,
                      cursor: isCurrent ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="change-plan"
                      value={plan.id}
                      checked={selectedId === plan.id}
                      disabled={isCurrent || busy}
                      onChange={() => setSelectedId(plan.id)}
                    />
                    <span>
                      <strong>
                        {plan.name}{' '}
                        <span className="muted" style={{ fontWeight: 400 }}>
                          — {formatCurrency(plan.price, plan.currency)}{' '}
                          {billingPeriodSuffix(plan.billing_period)}
                        </span>
                      </strong>{' '}
                      {isCurrent ? <Badge tone="info">Current plan</Badge> : null}
                      <span className="muted" style={{ fontSize: '0.8rem', display: 'block' }}>
                        {plan.feature_summary.length > 0
                          ? `${plan.feature_summary.slice(0, 4).join(', ')}${plan.feature_summary.length > 4 ? '…' : ''}`
                          : 'No features enabled'}
                        {plan.limit_summary.length > 0
                          ? ` · ${plan.limit_summary
                              .slice(0, 3)
                              .map((limit) => `${limit.label}: ${limit.display}`)
                              .join(', ')}`
                          : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => setConfirming(true)}
              disabled={busy || !selectedPlan || selectedPlan.id === currentPlan?.id}
            >
              Continue
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
};
