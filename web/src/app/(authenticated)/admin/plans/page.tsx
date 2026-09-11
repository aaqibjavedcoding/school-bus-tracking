'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';
import {
  PLAN_FEATURE_LABELS,
  PLAN_LIMIT_RESOURCE_LABELS,
  PlanFeature,
  PlanLimitResource,
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

/**
 * Limits are grouped for display only — the underlying data model is untouched
 * and every resource is still read straight from `plan.limits`.
 */
const RESOURCE_GROUPS: Array<{ key: string; label: string; resources: PlanLimitResource[] }> = [
  {
    key: 'people',
    label: 'People & crew',
    resources: [
      PlanLimitResource.STUDENTS,
      PlanLimitResource.PARENTS,
      PlanLimitResource.DRIVERS,
      PlanLimitResource.CONDUCTORS,
      PlanLimitResource.STAFF,
    ],
  },
  {
    key: 'transport',
    label: 'Fleet & operations',
    resources: [
      PlanLimitResource.BUSES,
      PlanLimitResource.ROUTES,
      PlanLimitResource.STOPS,
      PlanLimitResource.TRIPS,
      PlanLimitResource.RUNS,
    ],
  },
];

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
} as const;

/** Compact line icon for each plan resource, matching the app's icon style. */
function LimitIcon({ resource }: { resource: PlanLimitResource }) {
  switch (resource) {
    case PlanLimitResource.STUDENTS:
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="7" r="3" />
          <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
        </svg>
      );
    case PlanLimitResource.PARENTS:
      return (
        <svg {...ICON_PROPS}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M16 19a4.8 4.8 0 0 1 5-4.2" />
        </svg>
      );
    case PlanLimitResource.DRIVERS:
    case PlanLimitResource.CONDUCTORS:
    case PlanLimitResource.STAFF:
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19a7 7 0 0 1 14 0" />
          <path d="M9.5 12.5h5" />
        </svg>
      );
    case PlanLimitResource.BUSES:
      return (
        <svg {...ICON_PROPS}>
          <rect x="4" y="4" width="16" height="12" rx="2" />
          <path d="M4 12h16M8 20v-1m8 1v-1M7 16h.01M17 16h.01" />
        </svg>
      );
    case PlanLimitResource.ROUTES:
      return (
        <svg {...ICON_PROPS}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M8 7c8 0 0 10 8 10" />
        </svg>
      );
    case PlanLimitResource.STOPS:
      return (
        <svg {...ICON_PROPS}>
          <path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case PlanLimitResource.TRIPS:
      return (
        <svg {...ICON_PROPS}>
          <path d="M5 19 19 5M9 5h10v10" />
        </svg>
      );
    case PlanLimitResource.RUNS:
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8l6 4-6 4z" />
        </svg>
      );
    default:
      return null;
  }
}

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
                <Card key={plan.id} className="plan-card">
                  <div className="plan-card__head">
                    <div className="plan-card__heading">
                      <Link href={`/admin/plans/${plan.id}`} className="plan-card__title">
                        {plan.name}
                      </Link>
                      <span className="plan-card__code">{plan.code}</span>
                    </div>
                    <Badge tone={plan.is_active ? 'success' : 'warning'}>
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <div className="plan-price">
                    <span className="plan-price__amount">
                      {formatCurrency(Number(plan.price), plan.currency)}
                    </span>
                    <span className="plan-price__period">
                      {BILLING_LABELS[plan.billing_period] ?? plan.billing_period}
                    </span>
                  </div>

                  <div className="plan-card__section">
                    <div className="plan-card__section-label">Limits</div>
                    {RESOURCE_GROUPS.map((group) => (
                      <div key={group.key} className="plan-card__group">
                        <span className="plan-card__group-label">{group.label}</span>
                        <div className="plan-stats">
                          {group.resources.map((resource) => {
                            const limit = plan.limits[resource];
                            return (
                              <div
                                key={resource}
                                className="plan-stat"
                                title={PLAN_LIMIT_RESOURCE_LABELS[resource]}
                              >
                                <span className="plan-stat__icon">
                                  <LimitIcon resource={resource} />
                                </span>
                                <span className="plan-stat__body">
                                  <span
                                    className={`plan-stat__value${
                                      limit?.unlimited ? ' plan-stat__value--unlimited' : ''
                                    }`}
                                  >
                                    {formatLimit(limit)}
                                  </span>
                                  <span className="plan-stat__label">
                                    {PLAN_LIMIT_RESOURCE_LABELS[resource]}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="plan-card__section">
                    <div className="plan-card__section-label">
                      Features <span className="muted">({enabled.length})</span>
                    </div>
                    {enabled.length === 0 ? (
                      <span className="muted plan-card__empty">
                        No optional feature enabled on this plan.
                      </span>
                    ) : (
                      <div className="plan-tags">
                        {enabled.map(([key]) => (
                          <Badge key={key} tone="info">
                            {PLAN_FEATURE_LABELS[key as PlanFeature] ?? key}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="plan-card__footer">
                    <div className="row" style={{ gap: '0.5rem' }}>
                      <Button
                        variant="secondary"
                        onClick={() => router.push(`/admin/plans/${plan.id}`)}
                      >
                        Edit plan
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => router.push(`/admin/plans/${plan.id}`)}
                      >
                        View
                      </Button>
                    </div>
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

                  <p className="plan-card__updated">
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
