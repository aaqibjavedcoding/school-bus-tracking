'use client';

import { useSearchParams } from 'next/navigation';
import React, { Suspense, useMemo, useState } from 'react';
import { TripStatus } from '@school-bus-tracking/shared-types';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
} from '../../../../components/ui';
import { TripTracker } from '../../../../features/tracking/TripTracker';
import { ChildFacts } from '../../../../features/parent/ChildCard';
import { useLoad } from '../../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../../lib/errors';
import { fullName, tripStatusLabel } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';

function ParentTrackingInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('child');
  const [childId, setChildId] = useState(requested ?? '');

  const children = useLoad(async () => {
    return unwrapEnvelope(await apiClient.listParentChildren()).items;
  }, []);

  const selectedId = childId || children.data?.[0]?.id || '';
  const child = useMemo(
    () => children.data?.find((item) => item.id === selectedId) ?? children.data?.[0] ?? null,
    [children.data, selectedId],
  );

  const tracking = useLoad(async () => {
    if (!child) return null;
    return unwrapEnvelope(await apiClient.getParentChildTracking(child.id));
  }, [child?.id]);

  if ((children.loading || tracking.loading) && !child) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (children.error || tracking.error || (!children.data && !children.loading)) {
    return (
      <div className="page">
        <ErrorState
          message={children.error || tracking.error || 'Could not load tracking'}
          onRetry={() => void (children.error ? children.reload() : tracking.reload())}
        />
      </div>
    );
  }
  if (!child) {
    return (
      <div className="page">
        <Card>
          <EmptyState
            title="No children yet"
            description="You don't have any children assigned to your account."
          />
        </Card>
      </div>
    );
  }

  const trip = tracking.data?.trip ?? null;
  const isActive =
    trip && (trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS);

  return (
    <div className="page">
      <PageHeader
        title="Live tracking"
        description="Select a child to follow the bus on the map in real time."
      />
      <Card>
        <label
          className="muted"
          htmlFor="tracking-child"
          style={{ display: 'block', marginBottom: '0.4rem' }}
        >
          Child
        </label>
        <Select
          id="tracking-child"
          value={selectedId}
          placeholder="Select a child"
          onChange={(event) => setChildId(event.target.value)}
          options={(children.data ?? []).map((item) => ({
            value: item.id,
            label: `${fullName(item)} · ${item.home_stop.route_code ?? 'no route'}`,
          }))}
        />
      </Card>

      {trip ? (
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong>{tripStatusLabel(trip.status)}</strong>
            <span className="muted">{fullName(child)}</span>
          </div>
          <ChildFacts
            items={[
              ['Route', child.home_stop.route_code ?? child.home_stop.route_name ?? null],
              ['Home stop', child.home_stop.name ?? null],
              [
                'Bus',
                child.today.bus
                  ? `${child.today.bus.bus_number ?? ''} ${child.today.bus.registration_number}`.trim()
                  : null,
              ],
              ['Driver', tracking.data?.driver ? fullName(tracking.data.driver) : null],
              ['Conductor', tracking.data?.conductor ? fullName(tracking.data.conductor) : null],
            ]}
          />
        </Card>
      ) : null}

      {isActive ? (
        <TripTracker
          tripId={trip.id}
          stops={tracking.data?.stops ?? []}
          highlightStopId={child.home_stop.id}
          emptyTitle="Waiting for GPS"
          emptyDescription="Live location is not available yet."
        />
      ) : (
        <Card>
          <EmptyState
            title={
              trip && trip.status === TripStatus.CANCELLED ? 'Trip cancelled' : 'No active trip'
            }
            description={
              trip && trip.status === TripStatus.CANCELLED
                ? "Today's trip has been cancelled."
                : 'There is no trip boarding or in progress for this child right now. Live location will appear once the run starts.'
            }
          />
        </Card>
      )}
    </div>
  );
}

export default function ParentTrackingPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <Skeleton lines={8} />
        </div>
      }
    >
      <ParentTrackingInner />
    </Suspense>
  );
}
