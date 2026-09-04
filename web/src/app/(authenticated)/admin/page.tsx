'use client';

import Link from 'next/link';
import React from 'react';
import { SubscriptionStatus } from '@school-bus-tracking/shared-types';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { formatCurrency, formatDateTime } from '../../../lib/format';
import { apiClient } from '../../../services/api';
import { BarList, DonutChart } from '../../../features/admin/components/Charts';
import { KpiCard, KpiGrid, KpiGridSkeleton } from '../../../features/admin/components/KpiCard';
import {
  planDistributionBars,
  resourceBars,
  revenueByPlan,
  schoolStatusSlices,
  schoolsWithSubscriptionStatus,
  subscriptionStatusSlices,
} from '../../../features/admin/metrics';

const number = (value: number): string => new Intl.NumberFormat().format(value);

/**
 * Platform dashboard of the Super Admin console (`/admin`).
 *
 * Reads the single existing aggregate endpoint (`GET /admin/dashboard`) and
 * presents it as a SaaS control panel: a headline KPI band, distribution
 * charts and an estimated-revenue block. Every number shown here comes from
 * that payload — nothing is fabricated client-side — and revenue figures are
 * explicitly labelled as estimates because no payment provider is connected.
 */
export default function AdminOverviewPage() {
  const { data, loading, error, reload } = useLoad(async () => {
    const envelope = await apiClient.getAdminDashboard();
    return unwrapEnvelope(envelope);
  }, []);

  const header = (
    <PageHeader
      title="Platform overview"
      description="Live SaaS metrics across every customer school on the platform."
      actions={
        <>
          <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Link href="/admin/schools/new">
            <Button>Add school</Button>
          </Link>
        </>
      }
    />
  );

  if (loading && !data) {
    return (
      <div className="page">
        {header}
        <KpiGridSkeleton count={8} />
        <Card title="Loading platform metrics">
          <Skeleton lines={8} />
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        {header}
        <ErrorState
          title="Unable to load the platform overview"
          message={error ?? 'The dashboard metrics could not be loaded. Please try again.'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const trialSchools = schoolsWithSubscriptionStatus(data, SubscriptionStatus.TRIALING);
  const primaryRevenue = data.estimated_revenue[0] ?? null;
  const otherCurrencies = Math.max(0, data.estimated_revenue.length - 1);
  const crew = data.users.drivers + data.users.conductors;
  const planRevenue = revenueByPlan(data);

  return (
    <div className="page">
      {header}

      <section aria-label="Platform key metrics">
        <KpiGrid>
          <KpiCard
            label="Total schools"
            value={number(data.schools.total)}
            hint="All tenants ever provisioned"
          />
          <KpiCard
            label="Active schools"
            value={number(data.schools.active)}
            tone="success"
            hint="Users can sign in"
          />
          <KpiCard
            label="Inactive schools"
            value={number(data.schools.inactive)}
            tone="warning"
            hint="Suspended, data retained"
          />
          <KpiCard
            label="Trial schools"
            value={number(trialSchools)}
            tone="info"
            hint="Current subscription is trialing"
          />
          <KpiCard
            label="Active subscriptions"
            value={number(data.subscriptions.active)}
            tone="success"
            hint={`${number(data.subscriptions.live)} live incl. trials`}
          />
          <KpiCard
            label="Past due subscriptions"
            value={number(data.subscriptions.past_due)}
            tone="warning"
            hint="Need follow-up"
          />
          <KpiCard
            label="Cancelled subscriptions"
            value={number(data.subscriptions.cancelled)}
            tone="danger"
            hint={`${number(data.subscriptions.expired)} expired`}
          />
          <KpiCard
            label="Active plans"
            value={number(data.plans.active)}
            hint={`${number(data.plans.total)} in the catalogue`}
          />
          <KpiCard label="Students" value={number(data.users.students)} hint="Across all schools" />
          <KpiCard
            label="Buses"
            value={number(data.transport.buses)}
            hint={`${number(data.transport.active_buses)} active`}
          />
          <KpiCard
            label="Drivers & conductors"
            value={number(crew)}
            hint={`${number(data.users.drivers)} drivers · ${number(data.users.conductors)} conductors`}
          />
          <KpiCard
            label="Active routes"
            value={number(data.transport.active_routes)}
            hint={`${number(data.transport.routes)} routes total`}
          />
          <KpiCard
            label="Estimated MRR"
            value={
              primaryRevenue
                ? formatCurrency(primaryRevenue.estimated_mrr, primaryRevenue.currency)
                : '—'
            }
            tone="info"
            caption="Estimated"
            hint={
              primaryRevenue
                ? `Based on ${number(primaryRevenue.live_subscriptions)} live subscription${primaryRevenue.live_subscriptions === 1 ? '' : 's'}${otherCurrencies > 0 ? ` · +${otherCurrencies} more currency` : ''}`
                : 'No live subscriptions yet'
            }
          />
          <KpiCard
            label="Estimated ARR"
            value={
              primaryRevenue
                ? formatCurrency(primaryRevenue.estimated_arr, primaryRevenue.currency)
                : '—'
            }
            tone="info"
            caption="Estimated"
            hint="Estimated MRR × 12 — not billed revenue"
          />
        </KpiGrid>
      </section>

      <div className="section-grid">
        <Card
          title="Schools by status"
          description="Tenant lifecycle: active tenants can sign in, inactive ones keep all their data."
        >
          <DonutChart
            slices={schoolStatusSlices(data)}
            centerValue={data.schools.total}
            centerLabel="Schools"
            emptyLabel="No schools have been provisioned yet."
          />
        </Card>

        <Card
          title="Schools by subscription status"
          description="Each school counted once, by the state of its current (or latest) subscription."
        >
          <DonutChart
            slices={subscriptionStatusSlices(data)}
            centerValue={data.schools.total}
            centerLabel="Schools"
            emptyLabel="No school has a subscription yet."
          />
        </Card>

        <Card
          title="Schools by plan"
          description="Distribution of tenants across the plan catalogue, with the live share of each plan."
        >
          <BarList rows={planDistributionBars(data)} emptyLabel="No school is on a plan yet." />
        </Card>

        <Card
          title="Platform resources"
          description="Total records managed by the platform across every tenant."
        >
          <BarList rows={resourceBars(data)} emptyLabel="No tenant data yet." />
        </Card>
      </div>

      <Card
        title="Estimated revenue"
        description="Derived from plan catalogue list prices attached to live subscriptions. No payment provider is connected — these are estimates, never billed or collected revenue."
      >
        {data.estimated_revenue.length === 0 ? (
          <EmptyState
            title="No live subscriptions"
            description="Estimated MRR and ARR appear as soon as schools hold a live subscription on a priced plan."
            action={
              <Link href="/admin/subscriptions">
                <Button variant="secondary">Review subscriptions</Button>
              </Link>
            }
          />
        ) : (
          <>
            <KpiGrid>
              {data.estimated_revenue.map((item) => (
                <React.Fragment key={item.currency}>
                  <KpiCard
                    label={`Estimated MRR (${item.currency})`}
                    value={formatCurrency(item.estimated_mrr, item.currency)}
                    caption="Estimated"
                    tone="info"
                    hint={`${number(item.live_subscriptions)} live subscription${item.live_subscriptions === 1 ? '' : 's'}`}
                  />
                  <KpiCard
                    label={`Estimated ARR (${item.currency})`}
                    value={formatCurrency(item.estimated_arr, item.currency)}
                    caption="Estimated"
                    tone="info"
                    hint="Monthly estimate × 12"
                  />
                </React.Fragment>
              ))}
            </KpiGrid>
            <div style={{ marginTop: '1rem' }}>
              <BarList
                rows={planRevenue.map((row) => ({
                  key: row.plan_id,
                  label: row.plan_name,
                  hint: `${row.live_schools} live · ${Math.round(row.share)}% of ${row.currency} MRR`,
                  value: row.estimated_mrr,
                  display: formatCurrency(row.estimated_mrr, row.currency),
                  tone: 'info' as const,
                }))}
                emptyLabel="No priced plan currently has a live subscription."
              />
            </div>
            <div className="row" style={{ marginTop: '1rem' }}>
              <Link href="/admin/revenue">
                <Button variant="secondary">Open revenue overview</Button>
              </Link>
            </div>
          </>
        )}
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.9rem' }}>
          {data.revenue_note}
        </p>
      </Card>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Metrics generated {formatDateTime(data.generated_at)}.
      </p>
    </div>
  );
}
