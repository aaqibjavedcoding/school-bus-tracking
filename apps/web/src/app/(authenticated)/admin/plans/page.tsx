'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';
import {
  PLAN_FEATURE_LABELS,
  PLAN_LIMIT_RESOURCE_VALUES,
  PLAN_LIMIT_RESOURCE_LABELS,
  PlanFeature,
  type AdminPlanStatus,
  type AdminPlanSummary,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { usePagedResource } from '../../../../hooks/usePagedResource';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { apiClient } from '../../../../services/api';
import { formatLimit } from '../../../../features/admin/metrics';

const BILLING_LABELS: Record<string, string> = {
  monthly: '/ month',
  yearly: '/ year',
};

type SortKey = 'created_at:desc' | 'price:asc' | 'price:desc' | 'name:asc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'price:asc', label: 'Price (low → high)' },
  { value: 'price:desc', label: 'Price (high → low)' },
  { value: 'name:asc', label: 'Name (A–Z)' },
];

/**
 * Plan catalogue of the Super Admin console (`/admin/plans`).
 *
 * Shows every commercial tier with its full limit matrix (unlimited vs a
 * fixed cap vs "not set" are visually distinct) and its enabled features.
 * Creation and editing live on dedicated pages; this screen owns discovery
 * plus the activate/deactivate lifecycle, both behind confirmation dialogs.
 */
export default function AdminPlansPage() {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<'' | AdminPlanStatus>('');
  const [sort, setSort] = useState<SortKey>('created_at:desc');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    id: string;
    name: string;
    action: 'activate' | 'deactivate';
  } | null>(null);

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<AdminPlanSummary>(
      async (currentPage, currentSearch) => {
        const [sortColumn, order] = sort.split(':') as [
          'created_at' | 'name' | 'price',
          'asc' | 'desc',
        ];
        const envelope = await apiClient.listAdminPlans({
          page: currentPage,
          limit: 12,
          search: currentSearch || undefined,
          status: status || undefined,
          sort: sortColumn,
          order,
        });
        return unwrapEnvelope(envelope);
      },
      [status, sort],
    );

  const hasFilters = Boolean(search || status) || sort !== 'created_at:desc';

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('');
    setSort('created_at:desc');
    setPage(1);
  }, [setPage, setSearch]);

  const runLifecycle = useCallback(
    async (id: string, name: string, action: 'activate' | 'deactivate') => {
      setBusyId(id);
      try {
        if (action === 'deactivate') {
          await apiClient.deactivateAdminPlan(id);
          toast.push(`${name} deactivated — hidden from new subscriptions.`, 'info');
        } else {
          await apiClient.activateAdminPlan(id);
          toast.push(`${name} activated — available for new subscriptions.`, 'success');
        }
        await reload();
      } catch (caught) {
        toast.push(
          getApiErrorMessage(caught, `Unable to ${action} ${name}. Please try again.`),
          'danger',
        );
      } finally {
        setBusyId(null);
      }
    },
    [reload, toast],
  );

  return (
    <div className="page">
      <PageHeader
        title="Plans"
        description="The commercial tiers schools can subscribe to. Limits are enforced by the API for every tenant on the plan."
        actions={
          <Link href="/admin/plans/new">
            <Button>Create plan</Button>
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Search plan name or code…"
        />
        <Select
          aria-label="Filter by plan status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | AdminPlanStatus);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active only' },
            { value: 'inactive', label: 'Inactive only' },
          ]}
          style={{ maxWidth: 190 }}
        />
        <Select
          aria-label="Sort plans"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as SortKey);
            setPage(1);
          }}
          options={SORT_OPTIONS}
          style={{ maxWidth: 210 }}
        />
        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <Skeleton lines={10} />
      ) : error ? (
        <ErrorState title="Unable to load plans" message={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No plans found"
          description={
            hasFilters
              ? 'No plan matches the current search and filters.'
              : 'Create your first subscription plan to start offering the platform commercially.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Link href="/admin/plans/new">
                <Button>Create plan</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="result-count" style={{ marginBottom: '0.5rem' }}>
            {meta.total} plan{meta.total === 1 ? '' : 's'} in the catalogue
          </p>
          <div className="card-grid" style={{ marginBottom: '1rem' }}>
            {items.map((plan) => {
              const enabled = Object.entries(plan.features).filter(([, on]) => on);
              return (
                <Card key={plan.id} title={plan.name} description={plan.description ?? undefined}>
                  <div
                    className="row"
                    style={{ justifyContent: 'space-between', marginBottom: '0.6rem' }}
                  >
                    <div>
                      <strong style={{ fontSize: '1.35rem' }}>
                        {formatCurrency(Number(plan.price), plan.currency)}
                      </strong>
                      <span className="muted">
                        {' '}
                        {BILLING_LABELS[plan.billing_period] ?? plan.billing_period}
                      </span>
                    </div>
                    <Badge tone={plan.is_active ? 'success' : 'warning'}>
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    Code: <code>{plan.code}</code>
                  </p>

                  <div style={{ marginBottom: '0.85rem' }}>
                    <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                      Resource limits
                    </div>
                    <dl className="detail-grid" style={{ gap: '0.4rem 1rem', margin: 0 }}>
                      {PLAN_LIMIT_RESOURCE_VALUES.map((resource) => {
                        const limit = plan.limits[resource];
                        return (
                          <div key={resource}>
                            <dt className="detail-item__label">
                              {PLAN_LIMIT_RESOURCE_LABELS[resource]}
                            </dt>
                            <dd
                              className="detail-item__value"
                              style={{
                                margin: 0,
                                fontWeight: 650,
                                color: limit?.unlimited ? '#2563eb' : undefined,
                              }}
                            >
                              {formatLimit(limit)}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>

                  <div style={{ marginBottom: '0.85rem' }}>
                    <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                      Features ({enabled.length})
                    </div>
                    {enabled.length === 0 ? (
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        No optional feature enabled on this plan.
                      </span>
                    ) : (
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
                    )}
                  </div>

                  <div className="row">
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/admin/plans/${plan.id}`)}
                    >
                      Edit plan
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
            page={meta.page}
            totalPages={meta.totalPages}
            hasNextPage={meta.hasNextPage}
            hasPreviousPage={meta.hasPreviousPage}
            onPage={setPage}
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
            ? 'Schools already on this plan keep their access and limits, but the plan will be hidden from new subscription flows. Existing subscriptions are unaffected.'
            : 'This plan will become available for new school subscriptions.'
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate plan' : 'Activate plan'}
        danger={confirm?.action === 'deactivate'}
        busy={busyId === confirm?.id}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { id, name, action } = confirm;
          setConfirm(null);
          void runLifecycle(id, name, action);
        }}
      />
    </div>
  );
}
