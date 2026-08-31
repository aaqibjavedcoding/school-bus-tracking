'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';
import type { AdminPlanStatus } from '@school-bus-tracking/shared-types';
import { PLAN_FEATURE_LABELS, PLAN_LIMIT_RESOURCE_LABELS, PlanFeature, PlanLimitResource } from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { apiClient } from '../../../../services/api';

interface ListState {
  page: number;
  limit: number;
  search: string;
  status: '' | AdminPlanStatus;
}

const INITIAL_STATE: ListState = { page: 1, limit: 10, search: '', status: '' };

const BILLING_LABELS: Record<string, string> = {
  monthly: '/ month',
  yearly: '/ year',
};

function formatLimitDisplay(
  limit: { unlimited: boolean; value: number | null } | undefined,
): string {
  if (!limit) return '—';
  if (limit.unlimited) return 'Unlimited';
  return new Intl.NumberFormat().format(Number(limit.value));
}

const SUMMARY_LIMITS: PlanLimitResource[] = [
  PlanLimitResource.STUDENTS,
  PlanLimitResource.BUSES,
  PlanLimitResource.ROUTES,
  PlanLimitResource.DRIVERS,
];

export default function AdminPlansPage() {
  const router = useRouter();
  const toast = useToast();
  const [filters, setFilters] = useState<ListState>(INITIAL_STATE);
  const [searchInput, setSearchInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    name: string;
    action: 'activate' | 'deactivate';
  } | null>(null);

  const { data, loading, error, reload, setData } = useLoad(async () => {
    const envelope = await apiClient.listAdminPlans({
      page: filters.page,
      limit: filters.limit,
      search: filters.search || undefined,
      status: filters.status || undefined,
    });
    return unwrapEnvelope(envelope);
  }, [filters.page, filters.limit, filters.search, filters.status]);

  const applySearch = useCallback(() => {
    setFilters((current) => ({ ...current, search: searchInput.trim(), page: 1 }));
  }, [searchInput]);

  const runLifecycle = useCallback(
    async (id: string, action: 'activate' | 'deactivate') => {
      setBusyId(id);
      try {
        if (action === 'deactivate') {
          await apiClient.deactivateAdminPlan(id);
          toast.push('Plan deactivated — no longer available for new subscriptions', 'info');
        } else {
          await apiClient.activateAdminPlan(id);
          toast.push('Plan activated', 'success');
        }
        setData(null);
        await reload();
      } catch (caught) {
        toast.push(getApiErrorMessage(caught, 'Lifecycle action failed'), 'danger');
      } finally {
        setBusyId(null);
      }
    },
    [reload, setData, toast],
  );

  return (
    <div className="page">
      <PageHeader
        title="Subscription Plans"
        description="Define the commercial tiers schools can subscribe to. Features and limits are configurable per plan."
        actions={
          <Link href="/admin/plans/new">
            <Button>Create plan</Button>
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <Input
            name="search"
            placeholder="Search name or code…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            style={{ minWidth: 260 }}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Select
          aria-label="Status filter"
          value={filters.status}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              status: event.target.value as '' | AdminPlanStatus,
              page: 1,
            }))
          }
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          style={{ maxWidth: 200 }}
        />
      </div>

      {loading && !data ? (
        <Skeleton lines={10} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No plans found"
          description={
            filters.search || filters.status
              ? 'Try a different search or filter.'
              : 'Create your first subscription plan to start offering the platform commercially.'
          }
          action={
            <Link href="/admin/plans/new">
              <Button>Create plan</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="card-grid" style={{ marginBottom: '1rem' }}>
            {data.items.map((plan) => {
              const enabled = Object.entries(plan.features).filter(([, on]) => on);
              return (
                <Card
                  key={plan.id}
                  title={plan.name}
                  description={plan.description ?? undefined}
                >
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div>
                      <strong style={{ fontSize: '1.4rem' }}>
                        {formatCurrency(Number(plan.price), plan.currency)}
                      </strong>
                      <span className="muted"> {BILLING_LABELS[plan.billing_period] ?? plan.billing_period}</span>
                    </div>
                    <Badge tone={plan.is_active ? 'success' : 'warning'}>
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    Code: <code>{plan.code}</code>
                  </p>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                      Key limits
                    </div>
                    <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                      {SUMMARY_LIMITS.map((res) => (
                        <Badge key={res} tone="neutral">
                          {PLAN_LIMIT_RESOURCE_LABELS[res]}: {formatLimitDisplay(plan.limits[res])}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.35rem' }}>
                      Features ({enabled.length})
                    </div>
                    <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                      {enabled.slice(0, 6).map(([key]) => (
                        <Badge key={key} tone="info">
                          {PLAN_FEATURE_LABELS[key as PlanFeature] ?? key}
                        </Badge>
                      ))}
                      {enabled.length > 6 ? (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          +{enabled.length - 6} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="row">
                    <Button
                      variant="ghost"
                      onClick={() => router.push(`/admin/plans/${plan.id}`)}
                    >
                      Edit
                    </Button>
                    {plan.is_active ? (
                      <Button
                        variant="danger"
                        disabled={busyId === plan.id}
                        onClick={() =>
                          setConfirm({ id: plan.id, name: plan.name, action: 'deactivate' })
                        }
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        disabled={busyId === plan.id}
                        onClick={() =>
                          setConfirm({ id: plan.id, name: plan.name, action: 'activate' })
                        }
                      >
                        Activate
                      </Button>
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.6rem' }}>
                    Updated {formatDateTime(plan.updated_at)}
                  </p>
                </Card>
              );
            })}
          </div>
          <Pagination
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            hasNextPage={data.meta.hasNextPage}
            hasPreviousPage={data.meta.hasPreviousPage}
            onPage={(page) => setFilters((current) => ({ ...current, page }))}
          />
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.action === 'deactivate'
            ? `Deactivate ${confirm?.name}?`
            : `Activate ${confirm?.name}?`
        }
        message={
          confirm?.action === 'deactivate'
            ? 'Schools already on this plan keep access, but the plan will be hidden from new subscription flows. Existing subscriptions are unaffected.'
            : 'This plan will become available for new school subscriptions.'
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate plan' : 'Activate plan'}
        danger={confirm?.action === 'deactivate'}
        busy={busyId === confirm?.id}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) {
            void runLifecycle(confirm.id, confirm.action);
            setConfirm(null);
          }
        }}
      />
    </div>
  );
}
