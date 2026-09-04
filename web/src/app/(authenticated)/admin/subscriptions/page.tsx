'use client';

import Link from 'next/link';
import React, { useCallback, useMemo, useState } from 'react';
import {
  SUBSCRIPTION_STATUS_LABELS,
  SubscriptionStatus,
  type AdminSubscriptionListItem,
} from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
} from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import { usePagedResource } from '../../../../hooks/usePagedResource';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';
import {
  billingPeriodSuffix,
  subscriptionStatusTone,
} from '../../../../features/admin/subscriptions/helpers';
import { compactUsage } from '../../../../features/admin/metrics';
import { KpiCard, KpiGrid } from '../../../../features/admin/components/KpiCard';

/** Quick filters a platform owner reaches for every day. */
const QUICK_FILTERS: Array<{ value: '' | SubscriptionStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: SubscriptionStatus.TRIALING, label: 'Trial' },
  { value: SubscriptionStatus.ACTIVE, label: 'Active' },
  { value: SubscriptionStatus.PAST_DUE, label: 'Past due' },
  { value: SubscriptionStatus.CANCELLED, label: 'Cancelled' },
  { value: SubscriptionStatus.NONE, label: 'No subscription' },
];

const STATUS_OPTIONS = Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/**
 * Platform-wide subscription console (`/admin/subscriptions`).
 *
 * Lists every school exactly once with its current (or latest) subscription,
 * as returned by `GET /admin/subscriptions`. Search, status and plan filters
 * are all applied server-side; the summary band re-uses the dashboard
 * aggregate so the counts always match the platform overview.
 */
export default function AdminSubscriptionsPage() {
  const [status, setStatus] = useState<'' | SubscriptionStatus>('');
  const [planId, setPlanId] = useState('');

  const { items, meta, setPage, search, setSearch, loading, searching, error, reload } =
    usePagedResource<AdminSubscriptionListItem>(
      async (currentPage, currentSearch) => {
        const envelope = await apiClient.listAdminSubscriptions({
          page: currentPage,
          limit: 20,
          search: currentSearch || undefined,
          status: status || undefined,
          plan_id: planId || undefined,
        });
        return unwrapEnvelope(envelope);
      },
      [status, planId],
    );

  const plansState = useLoad(async () => {
    const plans = await apiClient.listAdminPlans({ limit: 100, sort: 'name', order: 'asc' });
    return unwrapEnvelope(plans).items;
  }, []);

  // The dashboard aggregate already counts schools per subscription state —
  // re-used here instead of adding a second aggregate endpoint.
  const summaryState = useLoad(async () => {
    const envelope = await apiClient.getAdminDashboard();
    return unwrapEnvelope(envelope);
  }, []);

  const hasFilters = Boolean(search || status || planId);

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatus('');
    setPlanId('');
    setPage(1);
  }, [setPage, setSearch]);

  const summary = useMemo(() => {
    if (meta.total === 0) return 'No schools match these filters';
    const first = (meta.page - 1) * meta.limit + 1;
    const last = Math.min(meta.total, first + items.length - 1);
    return `Showing ${first}–${last} of ${meta.total} school${meta.total === 1 ? '' : 's'}`;
  }, [items.length, meta]);

  const counts = summaryState.data;

  return (
    <div className="page">
      <PageHeader
        title="Subscriptions"
        description="Every school's current plan, period and usage in one platform-wide view."
        actions={
          <Link href="/admin/plans">
            <Button variant="secondary">Plan catalogue</Button>
          </Link>
        }
      />

      {counts ? (
        <KpiGrid>
          <KpiCard label="Schools" value={counts.schools.total} hint="On the platform" />
          <KpiCard label="Trialing" value={counts.subscriptions.trialing} tone="info" />
          <KpiCard label="Active" value={counts.subscriptions.active} tone="success" />
          <KpiCard label="Past due" value={counts.subscriptions.past_due} tone="warning" />
          <KpiCard label="Cancelled" value={counts.subscriptions.cancelled} tone="danger" />
          <KpiCard label="Expired" value={counts.subscriptions.expired} hint="Kept for history" />
        </KpiGrid>
      ) : null}

      <div className="toolbar" style={{ margin: '1rem 0 0.6rem' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          searching={searching}
          placeholder="Search school name, code, subdomain or city…"
        />
        <Select
          aria-label="Filter by subscription status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as '' | SubscriptionStatus);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          style={{ maxWidth: 200 }}
        />
        <Select
          aria-label="Filter by plan"
          value={planId}
          onChange={(event) => {
            setPlanId(event.target.value);
            setPage(1);
          }}
          options={(plansState.data ?? []).map((plan) => ({ value: plan.id, label: plan.name }))}
          placeholder="All plans"
          disabled={Boolean(plansState.loading) || Boolean(plansState.error)}
          style={{ maxWidth: 220 }}
        />
        {hasFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="filter-chips" style={{ marginBottom: '1rem' }}>
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            type="button"
            className="filter-chip"
            aria-pressed={status === filter.value}
            onClick={() => {
              setStatus(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <Card>
        {loading && items.length === 0 ? (
          <Skeleton lines={10} />
        ) : error ? (
          <ErrorState
            title="Unable to load subscriptions"
            message={error}
            onRetry={() => void reload()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No subscriptions found"
            description={
              hasFilters
                ? 'No school matches the current search and filters.'
                : 'No schools have a subscription yet. Assign a plan from a school detail page.'
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link href="/admin/schools">
                  <Button variant="secondary">Go to schools</Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <p className="result-count" style={{ marginBottom: '0.5rem' }}>
              {summary}
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">School</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Status</th>
                    <th scope="col">Current period</th>
                    <th scope="col">Trial</th>
                    <th scope="col">Usage vs limits</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.school_id}>
                      <td>
                        <Link className="linkish" href={`/admin/schools/${item.school_id}`}>
                          {item.school_name}
                        </Link>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          <code>{item.school_code}</code>
                          {item.school_city ? ` · ${item.school_city}` : ''}
                          {item.school_is_active ? '' : ' · tenant inactive'}
                        </div>
                      </td>
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
                          <span className="muted">No plan</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                          <Badge tone={subscriptionStatusTone(item.status)}>
                            {SUBSCRIPTION_STATUS_LABELS[item.status]}
                          </Badge>
                          {item.is_current ? <Badge tone="info">Current</Badge> : null}
                        </div>
                      </td>
                      <td>
                        {item.current_period_start || item.current_period_end ? (
                          <>
                            {formatDateTime(item.current_period_start)}
                            {' → '}
                            {item.current_period_end
                              ? formatDateTime(item.current_period_end)
                              : 'open-ended'}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {item.trial_start || item.trial_end
                          ? `${formatDateTime(item.trial_start)} → ${formatDateTime(item.trial_end)}`
                          : '—'}
                      </td>
                      <td>
                        <UsageCell item={item} />
                      </td>
                      <td>{formatDateTime(item.updated_at ?? item.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <Link href={`/admin/schools/${item.school_id}`}>
                            <Button variant="ghost">Manage</Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      </Card>

      {plansState.error ? (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Plan filter unavailable:{' '}
          {getApiErrorMessage(plansState.error, 'the plan catalogue could not be loaded')}
        </p>
      ) : null}
    </div>
  );
}

/** Compact usage-vs-plan-limit cell; only resources the plan constrains. */
const UsageCell: React.FC<{ item: AdminSubscriptionListItem }> = ({ item }) => {
  const entries = (
    [
      ['students', 'Students', item.usage.students],
      ['buses', 'Buses', item.usage.buses],
      ['routes', 'Routes', item.usage.routes],
      ['stops', 'Stops', item.usage.stops],
      ['drivers', 'Drivers', item.usage.drivers],
      ['conductors', 'Conductors', item.usage.conductors],
      ['parents', 'Parents', item.usage.parents],
      ['trips', 'Trips', item.usage.trips],
    ] as const
  ).filter(([key]) => item.limits[key] !== undefined);

  if (entries.length === 0) {
    return <span className="muted">No plan limits</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem' }}>
      {entries.map(([key, label, usage]) => (
        <span key={key}>
          <span className="muted">{label}:</span> {compactUsage(usage, item.limits[key])}
        </span>
      ))}
    </div>
  );
};
