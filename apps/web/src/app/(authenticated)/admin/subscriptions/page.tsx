'use client';

import Link from 'next/link';
import React, { useCallback, useState } from 'react';
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
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
} from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../lib/errors';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';
import {
  billingPeriodSuffix,
  subscriptionStatusTone,
} from '../../../../features/admin/subscriptions/helpers';

interface Filters {
  page: number;
  limit: number;
  search: string;
  status: '' | SubscriptionStatus;
  plan_id: string;
}

const INITIAL: Filters = { page: 1, limit: 20, search: '', status: '', plan_id: '' };

const STATUS_OPTIONS = Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function AdminSubscriptionsPage() {
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [searchInput, setSearchInput] = useState('');

  const { data, loading, error, reload } = useLoad(async () => {
    const envelope = await apiClient.listAdminSubscriptions({
      page: filters.page,
      limit: filters.limit,
      search: filters.search || undefined,
      status: filters.status || undefined,
      plan_id: filters.plan_id || undefined,
    });
    return unwrapEnvelope(envelope);
  }, [filters.page, filters.limit, filters.search, filters.status, filters.plan_id]);

  const plansState = useLoad(async () => {
    const plans = await apiClient.listAdminPlans({ limit: 100, sort: 'name', order: 'asc' });
    return unwrapEnvelope(plans).items;
  }, []);

  const applySearch = useCallback(() => {
    setFilters((current) => ({ ...current, search: searchInput.trim(), page: 1 }));
  }, [searchInput]);

  return (
    <div className="page">
      <PageHeader
        title="Subscriptions"
        description="Platform-wide view of every school's current subscription, plan, period and usage."
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
            name="subscription-search"
            placeholder="Search school name, code or city…"
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
              status: event.target.value as '' | SubscriptionStatus,
              page: 1,
            }))
          }
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          style={{ maxWidth: 200 }}
        />
        <Select
          aria-label="Plan filter"
          value={filters.plan_id}
          onChange={(event) =>
            setFilters((current) => ({ ...current, plan_id: event.target.value, page: 1 }))
          }
          options={(plansState.data ?? []).map((plan) => ({
            value: plan.id,
            label: plan.name,
          }))}
          placeholder="All plans"
          disabled={Boolean(plansState.loading) || Boolean(plansState.error)}
          style={{ maxWidth: 220 }}
        />
      </div>

      <Card>
        {loading && !data ? (
          <Skeleton lines={10} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No subscriptions found"
            description={
              filters.search || filters.status || filters.plan_id
                ? 'Try a different search or filter.'
                : 'No schools have a subscription yet. Assign a plan from a school details page.'
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>School</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Period</th>
                    <th>Trial</th>
                    <th>Usage</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.school_id}>
                      <td>
                        <Link className="linkish" href={`/admin/schools/${item.school_id}`}>
                          {item.school_name}
                        </Link>
                        <div className="muted" style={{ fontSize: '0.8rem' }}>
                          <code>{item.school_code}</code>
                          {item.school_city ? ` · ${item.school_city}` : ''}
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
                        <Badge tone={subscriptionStatusTone(item.status)}>
                          {SUBSCRIPTION_STATUS_LABELS[item.status]}
                        </Badge>
                        {item.is_current ? <Badge tone="info">Current</Badge> : null}
                      </td>
                      <td>
                        {item.current_period_start || item.current_period_end ? (
                          <>
                            {formatDateTime(item.current_period_start)}
                            {' → '}
                            {item.current_period_end
                              ? formatDateTime(item.current_period_end)
                              : 'open'}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {item.trial_start || item.trial_end ? (
                          <>
                            {formatDateTime(item.trial_start)}
                            {' → '}
                            {formatDateTime(item.trial_end)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <UsageRow item={item} />
                      </td>
                      <td>
                        <Link href={`/admin/schools/${item.school_id}`}>
                          <Button variant="ghost">View school</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      </Card>

      {plansState.error ? (
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Plan filter unavailable: {getApiErrorMessage(plansState.error, 'Could not load plans')}
        </p>
      ) : null}
    </div>
  );
}

/** Compact usage-vs-plan-limit cell. */
const UsageRow: React.FC<{ item: AdminSubscriptionListItem }> = ({ item }) => {
  const entries = [
    { key: 'students', label: 'Students', limit: item.limits.students, usage: item.usage.students },
    { key: 'buses', label: 'Buses', limit: item.limits.buses, usage: item.usage.buses },
    { key: 'routes', label: 'Routes', limit: item.limits.routes, usage: item.usage.routes },
    { key: 'drivers', label: 'Drivers', limit: item.limits.drivers, usage: item.usage.drivers },
    { key: 'conductors', label: 'Conductors', limit: item.limits.conductors, usage: item.usage.conductors },
    { key: 'parents', label: 'Parents', limit: item.limits.parents, usage: item.usage.parents },
    { key: 'stops', label: 'Stops', limit: item.limits.stops, usage: item.usage.stops },
    { key: 'trips', label: 'Trips', limit: item.limits.trips, usage: item.usage.trips },
  ].filter((entry) => entry.limit !== undefined);

  if (entries.length === 0) {
    return <span className="muted">No plan limits</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.8rem' }}>
      {entries.map((entry) => (
        <span key={entry.key}>
          <span className="muted">{entry.label}:</span>{' '}
          {entry.limit?.unlimited ? (
            `${entry.usage} / unlimited`
          ) : (
            <>
              {entry.usage} / {entry.limit?.value ?? '—'}
            </>
          )}
        </span>
      ))}
    </div>
  );
};
