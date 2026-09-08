'use client';

import { useSearchParams } from 'next/navigation';
import React, { Suspense, useMemo, useState } from 'react';
import { TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { Card, ErrorState, PageHeader, Select, Skeleton } from '../../../components/ui';
import { useAuth } from '../../../features/auth/AuthProvider';
import { TripTracker } from '../../../features/tracking/TripTracker';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { formatDateTime, tripStatusLabel, utcDateOnly } from '../../../lib/format';
import { apiClient } from '../../../services/api';

function TrackingInner() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const requested = searchParams.get('trip');
  const [tripId, setTripId] = useState(requested ?? '');

  const { data, loading, error, reload } = useLoad(async () => {
    const [tripList, routeList] = await Promise.all([
      apiClient.listTrips({
        page: 1,
        limit: 50,
        date: user?.role === UserRole.SCHOOL_ADMIN ? utcDateOnly() : undefined,
      }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
    ]);
    const trips = unwrapEnvelope(tripList).items;
    const selectedId = requested || tripId || trips[0]?.id || '';
    const selected = trips.find((trip) => trip.id === selectedId) ?? trips[0] ?? null;
    return {
      trips,
      routes: unwrapEnvelope(routeList).items,
      selected,
      selectedId: selected?.id ?? '',
    };
  }, [requested, user?.role]);

  const activeId = tripId || data?.selectedId || requested || null;
  const selected = useMemo(
    () => data?.trips.find((trip) => trip.id === activeId) ?? data?.selected ?? null,
    [data, activeId],
  );

  // Stops are fetched once per selected route — by this loader only. (The
  // initial trip list used to fetch them a second time inside the main
  // loader, doubling the `/routes/:id/stops` request on every page mount.)
  // The route id rides along so a previous trip's stops can never be drawn
  // on the map while the new selection is still loading.
  const { data: stopsResult } = useLoad(async () => {
    const routeId = selected?.route_id ?? null;
    if (!routeId) return null;
    return {
      routeId,
      stops: unwrapEnvelope(await apiClient.listRouteStops(routeId)).items,
    };
  }, [selected?.id, selected?.route_id]);

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
        <ErrorState message={error || 'Could not load trips'} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Live tracking"
        description="OpenStreetMap view of the bus, interpolated between GPS fixes from the crew device."
      />
      <Card>
        <div className="toolbar">
          <Select
            value={activeId ?? ''}
            placeholder="Select a trip"
            onChange={(event) => setTripId(event.target.value)}
            options={data.trips.map((trip) => ({
              value: trip.id,
              label: `${data.routes.find((route) => route.id === trip.route_id)?.code ?? 'Route unavailable'} · ${formatDateTime(trip.scheduled_start_at)} · ${tripStatusLabel(trip.status)}`,
            }))}
          />
        </div>
      </Card>
      <TripTracker
        tripId={selected?.id ?? null}
        stops={
          stopsResult && selected && stopsResult.routeId === selected.route_id
            ? stopsResult.stops
            : []
        }
        emptyTitle="No trip to follow"
        emptyDescription={
          selected
            ? 'Waiting for GPS.'
            : 'There is no trip in your scope yet. When a run is scheduled, it will appear here.'
        }
      />
      {selected &&
      selected.status !== TripStatus.BOARDING &&
      selected.status !== TripStatus.IN_PROGRESS ? (
        <p className="muted">
          Tracking is live while the trip is boarding or in progress. The last known position
          remains visible after the run closes.
        </p>
      ) : null}
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <Skeleton lines={8} />
        </div>
      }
    >
      <TrackingInner />
    </Suspense>
  );
}
