'use client';

import Link from 'next/link';
import React from 'react';
import { TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { Badge, Card, PageHeader, Skeleton, ErrorState } from '../../components/ui';
import { useAuth } from '../../features/auth/AuthProvider';
import { useLoad } from '../../hooks/useLoad';
import { unwrapEnvelope } from '../../lib/errors';
import { formatDateTime, tripStatusLabel, tripStatusTone, utcDateOnly } from '../../lib/format';
import { apiClient } from '../../services/api';

export default function DashboardPage() {
  const { user } = useAuth();
  const today = utcDateOnly();
  const isSchoolAdmin = user?.role === UserRole.SCHOOL_ADMIN;
  const { data, loading, error, reload } = useLoad(async () => {
    if (!isSchoolAdmin) {
      return null;
    }
    const [students, buses, routes, trips] = await Promise.all([
      apiClient.listStudents({ page: 1, limit: 1 }),
      apiClient.listBuses({ page: 1, limit: 1 }),
      apiClient.listRoutes({ page: 1, limit: 1 }),
      apiClient.listTrips({ page: 1, limit: 8, date: today }),
    ]);
    return {
      studentCount: unwrapEnvelope(students).meta.total,
      busCount: unwrapEnvelope(buses).meta.total,
      routeCount: unwrapEnvelope(routes).meta.total,
      trips: unwrapEnvelope(trips),
    };
  }, [today, isSchoolAdmin]);

  if (user?.role === UserRole.SUPER_ADMIN) {
    return (
      <div className="page">
        <PageHeader
          title="Platform console"
          description="School workspaces are managed through the API. Sign in as a school admin to operate a fleet."
        />
      </div>
    );
  }

  if (!isSchoolAdmin) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }

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
        <ErrorState message={error || 'Dashboard failed to load'} onRetry={() => void reload()} />
      </div>
    );
  }

  const live = data.trips.items.filter(
    (trip) => trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS,
  );

  return (
    <div className="page">
      <PageHeader
        title="Operations dashboard"
        description="Today's fleet, routes and live runs for your school."
      />
      <div className="grid grid-4">
        <Card className="stat-card">
          <span className="label">Students</span>
          <span className="value">{data.studentCount}</span>
        </Card>
        <Card className="stat-card">
          <span className="label">Buses</span>
          <span className="value">{data.busCount}</span>
        </Card>
        <Card className="stat-card">
          <span className="label">Routes</span>
          <span className="value">{data.routeCount}</span>
        </Card>
        <Card className="stat-card">
          <span className="label">Live trips</span>
          <span className="value">{live.length}</span>
        </Card>
      </div>
      <Card title="Today's trips" description={`Scheduled on ${today} (UTC)`}>
        {data.trips.items.length === 0 ? (
          <p className="muted">No trips scheduled today.</p>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Start</th>
                  <th>Route</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.trips.items.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <Badge tone={tripStatusTone(trip.status)}>
                        {tripStatusLabel(trip.status)}
                      </Badge>
                    </td>
                    <td>{formatDateTime(trip.scheduled_start_at)}</td>
                    <td className="muted">{trip.route_id.slice(0, 8)}…</td>
                    <td>
                      <Link className="linkish" href={`/trips/${trip.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
