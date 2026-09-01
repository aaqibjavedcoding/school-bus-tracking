'use client';

import Link from 'next/link';
import React from 'react';
import { SUBSCRIPTION_STATUS_LABELS } from '@school-bus-tracking/shared-types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { formatCurrency, formatDateTime } from '../../../lib/format';
import { apiClient } from '../../../services/api';
import {
  billingPeriodSuffix,
  subscriptionStatusTone,
} from '../../../features/admin/subscriptions/helpers';

interface StatCard {
  label: string;
  value: number | string;
  hint?: string;
}

const StatGrid: React.FC<{ cards: StatCard[] }> = ({ cards }) => (
  <div className="stat-grid" style={{ marginBottom: '1.25rem' }}>
    {cards.map((card) => (
      <div className="stat-card" key={card.label}>
        <span className="label">{card.label}</span>
        <span className="value">{card.value}</span>
        {card.hint ? (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {card.hint}
          </span>
        ) : null}
      </div>
    ))}
  </div>
);

export default function AdminOverviewPage() {
  const { data, loading, error, reload } = useLoad(async () => {
    const envelope = await apiClient.getAdminDashboard();
    return unwrapEnvelope(envelope);
  }, []);

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader
          title="Platform overview"
          description="SaaS-level metrics across all customer schools."
        />
        <Skeleton lines={12} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <PageHeader title="Platform overview" />
        <ErrorState
          message={error ?? 'Unable to load platform metrics'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Platform overview"
        description="SaaS-level metrics across all customer schools."
        actions={
          <Link href="/admin/schools/new">
            <Button>Add school</Button>
          </Link>
        }
      />

      <Card title="Schools" description="Tenant lifecycle across the platform.">
        <StatGrid
          cards={[
            { label: 'Total schools', value: data.schools.total },
            {
              label: 'Active',
              value: data.schools.active,
              hint: 'Schools currently serving users',
            },
            {
              label: 'Inactive',
              value: data.schools.inactive,
              hint: 'Suspended tenants, data retained',
            },
          ]}
        />
        <div className="row">
          <Badge tone="success">{data.schools.active} active</Badge>
          <Badge tone="warning">{data.schools.inactive} inactive</Badge>
        </div>
      </Card>

      <Card title="Users" description="Accounts by role across all active and inactive tenants.">
        <StatGrid
          cards={[
            { label: 'School admins', value: data.users.school_admins },
            { label: 'Students', value: data.users.students },
            { label: 'Parents', value: data.users.parents },
            { label: 'Drivers', value: data.users.drivers },
            { label: 'Conductors', value: data.users.conductors },
            { label: 'Platform admins', value: data.users.super_admins },
          ]}
        />
      </Card>

      <Card
        title="Transport operations"
        description="Fleet, route network and current trip activity."
      >
        <StatGrid
          cards={[
            {
              label: 'Buses',
              value: `${data.transport.buses} (${data.transport.active_buses} active)`,
            },
            {
              label: 'Routes',
              value: `${data.transport.routes} (${data.transport.active_routes} active)`,
            },
            {
              label: 'Active trips',
              value: `${data.transport.active_trips} / ${data.transport.trips}`,
              hint: 'Scheduled, boarding or in progress',
            },
          ]}
        />
      </Card>

      <Card
        title="Subscriptions"
        description="Every persisted subscription record, including historical cancelled and expired rows."
      >
        <StatGrid
          cards={[
            { label: 'Total subscriptions', value: data.subscriptions.total },
            { label: 'Live', value: data.subscriptions.live },
            { label: 'Trialing', value: data.subscriptions.trialing },
            { label: 'Active', value: data.subscriptions.active },
            { label: 'Past due', value: data.subscriptions.past_due },
            { label: 'Cancelled', value: data.subscriptions.cancelled },
            { label: 'Expired', value: data.subscriptions.expired },
          ]}
        />
      </Card>

      <Card title="Plans" description="Platform plan catalogue lifecycle.">
        <StatGrid
          cards={[
            { label: 'Total plans', value: data.plans.total },
            { label: 'Active', value: data.plans.active },
            { label: 'Inactive', value: data.plans.inactive },
          ]}
        />
      </Card>

      <Card
        title="Subscription status distribution"
        description="Schools split by their current/latest subscription state. A school without any subscription is reported as 'No subscription'."
      >
        {data.school_subscription_status.length === 0 ? (
          <EmptyState title="No subscriptions" description="No school has a subscription yet." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Schools</th>
                </tr>
              </thead>
              <tbody>
                {data.school_subscription_status.map((item) => (
                  <tr key={item.status}>
                    <td>
                      <Badge tone={subscriptionStatusTone(item.status)}>
                        {SUBSCRIPTION_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                    <td>{item.schools}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Plan distribution"
        description="Schools grouped by the plan of their current/latest subscription."
      >
        {data.plan_distribution.length === 0 ? (
          <EmptyState title="No plan assignments" description="No school is on a plan yet." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Schools</th>
                  <th>Live schools</th>
                </tr>
              </thead>
              <tbody>
                {data.plan_distribution.map((item) => (
                  <tr key={item.plan_id ?? 'none'}>
                    <td>
                      {item.plan_name ?? 'Unknown plan'}
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        <code>{item.plan_code ?? '—'}</code>
                      </div>
                    </td>
                    <td>
                      {item.price && item.currency ? (
                        <>
                          {formatCurrency(item.price, item.currency)}{' '}
                          {billingPeriodSuffix(item.billing_period)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{item.schools}</td>
                    <td>{item.live_schools}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Estimated revenue"
        description="Calculated from the plan catalogue list price attached to live subscriptions. No payment provider is connected — these are estimates, not invoiced or received revenue."
      >
        {data.estimated_revenue.length === 0 ? (
          <EmptyState
            title="No live subscriptions"
            description="Estimated MRR / ARR will appear once schools hold live subscriptions."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th>Estimated MRR</th>
                  <th>Estimated ARR</th>
                  <th>Live subscriptions</th>
                </tr>
              </thead>
              <tbody>
                {data.estimated_revenue.map((item) => (
                  <tr key={item.currency}>
                    <td>{item.currency}</td>
                    <td>{formatCurrency(item.estimated_mrr, item.currency)}</td>
                    <td>{formatCurrency(item.estimated_arr, item.currency)}</td>
                    <td>{item.live_subscriptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.75rem' }}>
          {data.revenue_note}
        </p>
      </Card>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Metrics generated {formatDateTime(data.generated_at)}
      </p>
    </div>
  );
}
