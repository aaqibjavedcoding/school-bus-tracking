'use client';

import Link from 'next/link';
import React from 'react';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../../lib/errors';
import { formatCurrency, formatDateTime } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';
import { BarList, DonutChart } from '../../../../features/admin/components/Charts';
import { KpiCard, KpiGrid, KpiGridSkeleton } from '../../../../features/admin/components/KpiCard';
import {
  revenueByPlan,
  schoolsWithSubscriptionStatus,
  subscriptionStatusSlices,
} from '../../../../features/admin/metrics';

const number = (value: number): string => new Intl.NumberFormat().format(value);

/**
 * Revenue overview of the Super Admin console (`/admin/revenue`).
 *
 * There is no payment provider, invoicing or cash ledger in this platform, so
 * this page never claims collected revenue. It re-uses the existing dashboard
 * aggregate endpoint and presents the commercial picture that *is* derivable
 * from plan prices and live subscriptions, with every figure labelled as an
 * estimate.
 */
export default function AdminRevenuePage() {
  const { data, loading, error, reload } = useLoad(async () => {
    const envelope = await apiClient.getAdminDashboard();
    return unwrapEnvelope(envelope);
  }, []);

  const header = (
    <PageHeader
      title="Revenue overview"
      description="Estimated subscription value of the platform — derived from plan prices, not from collected payments."
      actions={
        <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="page">
        {header}
        <KpiGridSkeleton count={6} />
        <Card title="Loading revenue estimates">
          <Skeleton lines={6} />
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        {header}
        <ErrorState
          title="Unable to load the revenue overview"
          message={error ?? 'The revenue estimates could not be loaded. Please try again.'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const planRevenue = revenueByPlan(data);
  const trialSchools = schoolsWithSubscriptionStatus(data, SubscriptionStatus.TRIALING);

  return (
    <div className="page">
      {header}

      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <Badge tone="info">Estimates only</Badge>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          No payment provider, invoicing or dunning is connected to this platform.
        </span>
      </div>

      <KpiGrid>
        {data.estimated_revenue.length === 0 ? (
          <>
            <KpiCard
              label="Estimated MRR"
              value="—"
              caption="Estimated"
              hint="No live subscriptions"
            />
            <KpiCard
              label="Estimated ARR"
              value="—"
              caption="Estimated"
              hint="No live subscriptions"
            />
          </>
        ) : (
          data.estimated_revenue.map((item) => (
            <React.Fragment key={item.currency}>
              <KpiCard
                label={`Estimated MRR (${item.currency})`}
                value={formatCurrency(item.estimated_mrr, item.currency)}
                caption="Estimated"
                tone="info"
                hint="Based on active subscriptions"
              />
              <KpiCard
                label={`Estimated ARR (${item.currency})`}
                value={formatCurrency(item.estimated_arr, item.currency)}
                caption="Estimated"
                tone="info"
                hint={`${number(item.live_subscriptions)} live subscription${item.live_subscriptions === 1 ? '' : 's'}`}
              />
            </React.Fragment>
          ))
        )}
        <KpiCard
          label="Active subscriptions"
          value={number(data.subscriptions.active)}
          tone="success"
        />
        <KpiCard
          label="Trial subscriptions"
          value={number(data.subscriptions.trialing)}
          tone="info"
          hint={`${number(trialSchools)} school${trialSchools === 1 ? '' : 's'} currently trialing`}
        />
        <KpiCard
          label="Past due subscriptions"
          value={number(data.subscriptions.past_due)}
          tone="warning"
        />
        <KpiCard
          label="Cancelled subscriptions"
          value={number(data.subscriptions.cancelled)}
          tone="danger"
          hint={`${number(data.subscriptions.expired)} expired`}
        />
      </KpiGrid>

      <div className="section-grid">
        <Card
          title="Estimated revenue by plan"
          description="Plan list price × schools holding a live subscription on that plan."
        >
          {planRevenue.length === 0 ? (
            <EmptyState
              title="Nothing to estimate yet"
              description="Revenue is derived from priced plans with live subscriptions. Assign a plan to a school to see an estimate."
              action={
                <Link href="/admin/subscriptions">
                  <Button variant="secondary">Review subscriptions</Button>
                </Link>
              }
            />
          ) : (
            <>
              <BarList
                rows={planRevenue.map((row) => ({
                  key: row.plan_id,
                  label: row.plan_name,
                  hint: row.plan_code ?? undefined,
                  value: row.estimated_mrr,
                  display: formatCurrency(row.estimated_mrr, row.currency),
                  tone: 'info' as const,
                }))}
              />
              <div className="table-wrap" style={{ marginTop: '1rem' }}>
                <table className="data">
                  <caption className="muted" style={{ captionSide: 'bottom', padding: '0.5rem' }}>
                    Estimated values only — no payment has been billed or received.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Plan</th>
                      <th scope="col">Live schools</th>
                      <th scope="col">Estimated MRR</th>
                      <th scope="col">Estimated ARR</th>
                      <th scope="col">Share of MRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRevenue.map((row) => (
                      <tr key={row.plan_id}>
                        <td>
                          {row.plan_name}
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            <code>{row.plan_code ?? '—'}</code>
                          </div>
                        </td>
                        <td>{number(row.live_schools)}</td>
                        <td>{formatCurrency(row.estimated_mrr, row.currency)}</td>
                        <td>{formatCurrency(row.estimated_arr, row.currency)}</td>
                        <td>{Math.round(row.share)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        <Card
          title="Subscription mix"
          description="Where the platform's schools currently sit in the subscription lifecycle."
        >
          <DonutChart
            slices={subscriptionStatusSlices(data)}
            centerValue={data.schools.total}
            centerLabel="Schools"
            emptyLabel="No school has a subscription yet."
          />
          <div className="row" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
            <Link href="/admin/subscriptions">
              <Button variant="secondary">Manage subscriptions</Button>
            </Link>
            <Link href="/admin/plans">
              <Button variant="ghost">Plan catalogue</Button>
            </Link>
          </div>
        </Card>
      </div>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        {data.revenue_note}
      </p>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Estimates generated {formatDateTime(data.generated_at)}.
      </p>
    </div>
  );
}
