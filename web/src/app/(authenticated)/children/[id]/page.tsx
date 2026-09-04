'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React from 'react';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { Badge, Card, ErrorState, PageHeader, Skeleton } from '../../../../components/ui';
import { TripTracker } from '../../../../features/tracking/TripTracker';
import { useLoad } from '../../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../../lib/errors';
import {
  attendanceStatusLabel,
  attendanceTone,
  formatDateTime,
  formatTime,
  fullName,
  tripStatusLabel,
  tripStatusTone,
  utcDateOnly,
} from '../../../../lib/format';
import { apiClient } from '../../../../services/api';

export default function ChildTripPage() {
  const params = useParams<{ id: string }>();
  const { data, loading, error, reload } = useLoad(async () => {
    const student = unwrapEnvelope(await apiClient.getStudent(params.id));
    const trips = unwrapEnvelope(
      await apiClient.listTrips({ page: 1, limit: 20, date: utcDateOnly() }),
    ).items;
    const rank: Record<string, number> = {
      [TripStatus.IN_PROGRESS]: 0,
      [TripStatus.BOARDING]: 1,
      [TripStatus.SCHEDULED]: 2,
    };
    const trip =
      [...trips].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))[0] ?? null;
    if (!trip) {
      return { student, trip: null, stops: [], attendance: null };
    }
    const [stops, attendance] = await Promise.all([
      apiClient.listRouteStops(trip.route_id),
      apiClient.getTripStudent(trip.id, student.id),
    ]);
    return {
      student,
      trip,
      stops: unwrapEnvelope(stops).items,
      attendance: unwrapEnvelope(attendance),
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
        <ErrorState message={error || 'Could not load this child'} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={fullName(data.student)}
        description={data.student.admission_number}
        actions={
          <Link className="btn btn-secondary" href="/children">
            All children
          </Link>
        }
      />
      {!data.trip ? (
        <Card title="Today's trip">
          <p className="muted">There is no trip in progress for this child today.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-2">
            <Card title="Trip">
              <div className="row">
                <Badge tone={tripStatusTone(data.trip.status)}>
                  {tripStatusLabel(data.trip.status)}
                </Badge>
              </div>
              <p className="muted" style={{ marginTop: '0.6rem' }}>
                Scheduled {formatDateTime(data.trip.scheduled_start_at)}
              </p>
            </Card>
            <Card title="Boarding status">
              {data.attendance ? (
                <>
                  <Badge tone={attendanceTone(data.attendance.status)}>
                    {attendanceStatusLabel(data.attendance.status)}
                  </Badge>
                  <p className="muted" style={{ marginTop: '0.6rem' }}>
                    Stop {data.attendance.stop_sequence_number}: {data.attendance.stop_name}
                  </p>
                  {data.attendance.boarded_at ? (
                    <p className="muted">Boarded {formatTime(data.attendance.boarded_at)}</p>
                  ) : null}
                  {data.attendance.dropped_at ? (
                    <p className="muted">Dropped {formatTime(data.attendance.dropped_at)}</p>
                  ) : null}
                </>
              ) : (
                <p className="muted">Attendance has not been recorded yet.</p>
              )}
            </Card>
          </div>
          <Card title="Live bus">
            <TripTracker
              tripId={data.trip.id}
              stops={data.stops}
              highlightStopId={data.attendance?.stop_id}
            />
          </Card>
        </>
      )}
    </div>
  );
}
