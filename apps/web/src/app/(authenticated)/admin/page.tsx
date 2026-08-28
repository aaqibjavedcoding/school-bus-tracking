'use client';

import Link from 'next/link';
import React from 'react';
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { formatDateTime } from '../../../lib/format';
import { apiClient } from '../../../services/api';

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

      <Card title="Billing">
        <p className="muted">
          Plans, subscriptions and revenue metrics will appear here in the next SaaS phase. No
          payment provider is connected yet.
        </p>
      </Card>

      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Metrics generated {formatDateTime(data.generated_at)}
      </p>
    </div>
  );
}
