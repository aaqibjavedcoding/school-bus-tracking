'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React from 'react';
import { UserRole } from '@school-bus-tracking/shared-types';
import { canActAsCrewOnTrip } from '@school-bus-tracking/validation';
import { Badge, Card, ErrorState, PageHeader, Skeleton } from '../../../../components/ui';
import { ManifestList } from '../../../../features/attendance/ManifestList';
import { useAuth } from '../../../../features/auth/AuthProvider';
import { TripTracker } from '../../../../features/tracking/TripTracker';
import { DispatcherOverride } from '../../../../features/trips/DispatcherOverride';
import { TripLifecycleTimeline } from '../../../../features/trips/TripLifecycleTimeline';
import { TripStatusActions } from '../../../../features/trips/TripStatusActions';
import { useLoad } from '../../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../../lib/errors';
import { formatDateTime, tripStatusLabel, tripStatusTone } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { data, loading, error, reload, setData } = useLoad(async () => {
    const trip = unwrapEnvelope(await apiClient.getTrip(params.id));
    const [route, stops, manifest] = await Promise.all([
      apiClient.getRoute(trip.route_id),
      apiClient.listRouteStops(trip.route_id),
      apiClient.listTripStudents(params.id),
    ]);
    return {
      trip,
      route: unwrapEnvelope(route),
      stops: unwrapEnvelope(stops).items,
      manifest: unwrapEnvelope(manifest),
    };
  }, [params.id]);

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
        <ErrorState message={error || 'Trip not found'} onRetry={() => void reload()} />
      </div>
    );
  }

  const canRecord = user?.role === UserRole.SCHOOL_ADMIN;
  // One rule, one helper: crew of *this* trip act; everyone else reads.
  const crewActor = canActAsCrewOnTrip(user, data.trip);

  return (
    <div className="page">
      <PageHeader
        title={`${data.route.code} trip`}
        description={`${data.route.name} · Scheduled ${formatDateTime(data.trip.scheduled_start_at)}`}
        actions={
          <>
            <Badge tone={tripStatusTone(data.trip.status)}>
              {tripStatusLabel(data.trip.status)}
            </Badge>
            <Link className="btn btn-secondary" href="/trips">
              All trips
            </Link>
            <Link className="btn btn-secondary" href={`/tracking?trip=${data.trip.id}`}>
              Live map
            </Link>
          </>
        }
      />
      <div className="grid grid-2">
        <Card title="Lifecycle">
          {crewActor ? (
            /* A driver/conductor assigned to this trip keeps the crew buttons. */
            <TripStatusActions
              trip={data.trip}
              allowCancel={false}
              large
              onUpdated={(trip) => setData({ ...data, trip })}
            />
          ) : (
            <>
              <TripLifecycleTimeline trip={data.trip} />
              <DispatcherOverride
                trip={data.trip}
                onUpdated={(trip) => setData({ ...data, trip })}
              />
            </>
          )}
        </Card>
        <Card title="Live position">
          <TripTracker tripId={data.trip.id} stops={data.stops} />
        </Card>
      </div>
      <Card title="Attendance">
        <ManifestList
          manifest={data.manifest}
          canRecord={canRecord}
          onChange={(manifest) => setData({ ...data, manifest })}
        />
      </Card>
    </div>
  );
}
