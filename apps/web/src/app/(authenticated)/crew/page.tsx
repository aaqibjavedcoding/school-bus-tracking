'use client';

import React from 'react';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { isTripTrackingActive } from '@school-bus-tracking/validation';
import { Badge, Card, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { ManifestList } from '../../../features/attendance/ManifestList';
import { TripTracker } from '../../../features/tracking/TripTracker';
import { useCrewLocationShare } from '../../../features/tracking/useLiveTripTracking';
import { TripStatusActions } from '../../../features/trips/TripStatusActions';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { formatDateTime, tripStatusLabel, tripStatusTone, utcDateOnly } from '../../../lib/format';
import { apiClient } from '../../../services/api';

function pickTodaysTrip<T extends { status: TripStatus; scheduled_start_at: string }>(
  trips: T[],
): T | null {
  const rank: Record<string, number> = {
    [TripStatus.IN_PROGRESS]: 0,
    [TripStatus.BOARDING]: 1,
    [TripStatus.SCHEDULED]: 2,
    [TripStatus.COMPLETED]: 3,
    [TripStatus.CANCELLED]: 4,
  };
  return (
    [...trips].sort((a, b) => {
      const byStatus = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return a.scheduled_start_at.localeCompare(b.scheduled_start_at);
    })[0] ?? null
  );
}

export default function CrewPage() {
  const { data, loading, error, reload, setData } = useLoad(async () => {
    const trips = unwrapEnvelope(
      await apiClient.listTrips({ page: 1, limit: 20, date: utcDateOnly() }),
    ).items;
    const trip = pickTodaysTrip(trips);
    if (!trip) {
      return { trip: null, stops: [], manifest: null, trips };
    }
    const [stops, manifest] = await Promise.all([
      apiClient.listRouteStops(trip.route_id),
      apiClient.listTripStudents(trip.id),
    ]);
    return {
      trip,
      trips,
      stops: unwrapEnvelope(stops).items,
      manifest: unwrapEnvelope(manifest),
    };
  }, []);

  const sharing = Boolean(data?.trip && isTripTrackingActive(data.trip.status));
  const gpsError = useCrewLocationShare(data?.trip?.id ?? null, sharing);

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={10} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          message={error || "Could not load today's trip"}
          onRetry={() => void reload()}
        />
      </div>
    );
  }
  if (!data.trip || !data.manifest) {
    return (
      <div className="page">
        <PageHeader title="Today's trip" description="No trip is assigned to you for today." />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Today's trip"
        description={`Scheduled ${formatDateTime(data.trip.scheduled_start_at)}`}
        actions={
          <Badge tone={tripStatusTone(data.trip.status)}>{tripStatusLabel(data.trip.status)}</Badge>
        }
      />
      <Card title="Trip status" description="Use these controls at the stop and on the road.">
        <TripStatusActions
          large
          trip={data.trip}
          onUpdated={(trip) => setData({ ...data, trip })}
        />
        {sharing ? (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Sharing this device's GPS with families and the school office.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            GPS sharing starts automatically when the trip is boarding or in progress.
          </p>
        )}
        {gpsError ? <p className="field-error">{gpsError}</p> : null}
      </Card>
      <Card title="Live map">
        <TripTracker tripId={data.trip.id} stops={data.stops} />
      </Card>
      <Card title="Passenger manifest">
        <ManifestList
          large
          canRecord
          manifest={data.manifest}
          onChange={(manifest) => setData({ ...data, manifest })}
        />
      </Card>
    </div>
  );
}
