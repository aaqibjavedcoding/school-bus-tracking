'use client';

import Link from 'next/link';
import React from 'react';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { ChildCard } from '../../../features/parent/ChildCard';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { fullName } from '../../../lib/format';
import { apiClient } from '../../../services/api';

/**
 * Parent dashboard (`/parent`).
 *
 * Shows the parent's profile, their school and today's view of every linked
 * child. Everything is derived from the JWT on the server — a client never
 * supplies a parent id or school id.
 */
export default function ParentDashboardPage() {
  const { data, loading, error, reload } = useLoad(async () => {
    return unwrapEnvelope(await apiClient.getParentDashboard());
  }, []);

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          message={error || 'Could not load your dashboard'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Parent dashboard"
        description={
          data.school
            ? `${fullName(data.parent)} · ${data.school.name}`
            : `Welcome, ${fullName(data.parent)}`
        }
        actions={
          <Link className="btn btn-primary" href="/parent/tracking">
            Track bus
          </Link>
        }
      />
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>My children</h2>
            <p className="muted" style={{ margin: '0.3rem 0 0' }}>
              {data.count} {data.count === 1 ? 'child' : 'children'} linked to your account.
            </p>
          </div>
          <Link className="btn btn-secondary" href="/parent/children">
            View all
          </Link>
        </div>
      </Card>

      {data.count === 0 ? (
        <Card>
          <EmptyState
            title="No children yet"
            description="You don't have any children assigned to your account. Contact your school if you believe this is a mistake."
          />
        </Card>
      ) : (
        <div className="grid grid-2">
          {data.children.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}
