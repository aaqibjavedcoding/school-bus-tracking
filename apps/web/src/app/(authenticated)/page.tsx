'use client';

import Link from 'next/link';
import React from 'react';
import { TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { Badge, Button, Card, PageHeader, Skeleton, ErrorState } from '../../components/ui';
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
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listTrips({ page: 1, limit: 8, date: today }),
    ]);
    return {
      studentCount: unwrapEnvelope(students).meta.total,
      busCount: unwrapEnvelope(buses).meta.total,
      routeCount: unwrapEnvelope(routes).meta.total,
      routes: unwrapEnvelope(routes).items,
      trips: unwrapEnvelope(trips),
    };
  }, [today, isSchoolAdmin]);

  if (user?.role === UserRole.SUPER_ADMIN) {
    return (
      <div className="page">
        <PageHeader
          title="Platform console"
          description="SaaS-wide operations across all customer schools, plans and subscriptions."
        />
        <div className="grid grid-2" style={{ gap: '1rem' }}>
          <Card title="Platform overview" description="Aggregate schools, users, transport and subscription metrics.">
            <Link href="/admin">
              <Button>Open overview</Button>
            </Link>
          </Card>
          <Card title="Schools" description="Provision, inspect and suspend customer tenants.">
            <Link href="/admin/schools">
              <Button>Open schools</Button>
            </Link>
          </Card>
          <Card title="Subscriptions" description="Global view of plans, statuses and usage across all schools.">
            <Link href="/admin/subscriptions">
              <Button>Open subscriptions</Button>
            </Link>
          </Card>
          <Card title="Plans" description="Maintain the commercial plan catalogue and limits.">
            <Link href="/admin/plans">
              <Button>Open plans</Button>
            </Link>
          </Card>
        </div>
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
                    <td className="muted">
                      {data.routes.find((route) => route.id === trip.route_id)?.code ??
                        'Route unavailable'}
                    </td>
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
