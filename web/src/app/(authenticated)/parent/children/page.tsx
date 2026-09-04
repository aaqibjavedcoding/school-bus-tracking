'use client';

import React from 'react';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../../../components/ui';
import { ChildCard } from '../../../../features/parent/ChildCard';
import { useLoad } from '../../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../../lib/errors';
import { apiClient } from '../../../../services/api';

/**
 * My Children (`/parent/children`).
 *
 * Returns only the children belonging to the authenticated parent; the server
 * derives the parent from the JWT and never trusts a client-supplied id.
 */
export default function ParentChildrenPage() {
  const { data, loading, error, reload } = useLoad(async () => {
    return unwrapEnvelope(await apiClient.listParentChildren());
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
          message={error || 'Could not load your children'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="My children"
        description="Today's trip, bus, route and boarding status for each of your children."
      />
      {data.count === 0 ? (
        <Card>
          <EmptyState
            title="No children yet"
            description="You don't have any children assigned to your account. Contact your school if you believe this is a mistake."
          />
        </Card>
      ) : (
        <div className="grid grid-2">
          {data.items.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}
        </div>
      )}
    </div>
  );
}
