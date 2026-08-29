'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React from 'react';
import { TripStatus } from '@school-bus-tracking/shared-types';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '../../../../../components/ui';
import { TripTracker } from '../../../../../features/tracking/TripTracker';
import { ChildFacts, TodayTripStatus } from '../../../../../features/parent/ChildCard';
import { useLoad } from '../../../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../../../lib/errors';
import { formatDateTime, formatTime, fullName } from '../../../../../lib/format';
import { apiClient } from '../../../../../services/api';

/**
 * Child details (`/parent/children/[id]`).
 *
 * Only children linked to the authenticated parent are returned; the server
 * returns 404 for anyone else (including children of another school).
 */
export default function ParentChildDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, loading, error, reload } = useLoad(async () => {
    return unwrapEnvelope(await apiClient.getParentChildToday(params.id));
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
        <ErrorState
          message={error || 'This child is not associated with your account.'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const { child, driver, conductor, stops } = data;
  const trip = child.today.trip;
  const attendance = child.today.attendance;

  return (
    <div className="page">
      <PageHeader
        title={fullName(child)}
        description={`${child.admission_number}${child.grade_level ? ` · ${child.grade_level}` : ''}`}
        actions={
          <Link className="btn btn-secondary" href="/parent/children">
            All children
          </Link>
        }
      />

      <div className="grid grid-2">
        <Card title="Assigned transport">
          <ChildFacts
            items={[
              ['Route', child.home_stop.route_code ?? child.home_stop.route_name ?? null],
              [
                'Home stop',
                child.home_stop.name
                  ? child.home_stop.sequence_number
                    ? `${child.home_stop.sequence_number}. ${child.home_stop.name}`
                    : child.home_stop.name
                  : null,
              ],
              [
                'Bus',
                child.today.bus
                  ? `${child.today.bus.bus_number ?? ''} ${child.today.bus.registration_number}`.trim()
                  : null,
              ],
              [
                'Driver',
                driver ? `${fullName(driver)}` : <span className="muted">Not assigned</span>,
              ],
              [
                'Conductor',
                conductor ? `${fullName(conductor)}` : <span className="muted">Not assigned</span>,
              ],
            ]}
          />
        </Card>

        <Card title="Today's trip">
          <TodayTripStatus child={child} />
          {trip ? (
            <div style={{ marginTop: '0.6rem' }}>
              <ChildFacts
                items={[
                  ['Scheduled', trip ? formatDateTime(trip.scheduled_start_at) : null],
                  [
                    'Boarding',
                    attendance ? (
                      <Badge
                        tone={
                          attendance.status === 'DROPPED'
                            ? 'success'
                            : attendance.status === 'BOARDED'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {attendance.status === 'DROPPED'
                          ? 'Dropped'
                          : attendance.status === 'BOARDED'
                            ? 'Boarded'
                            : 'Not boarded'}
                      </Badge>
                    ) : (
                      <span className="muted">Not recorded</span>
                    ),
                  ],
                ]}
              />
              {attendance?.boarded_at ? (
                <p className="muted">Boarded at {formatTime(attendance.boarded_at)}</p>
              ) : null}
              {attendance?.dropped_at ? (
                <p className="muted">Dropped at {formatTime(attendance.dropped_at)}</p>
              ) : null}
            </div>
          ) : (
            <p className="muted" style={{ marginTop: '0.6rem' }}>
              No trip scheduled for today.
            </p>
          )}
        </Card>
      </div>

      <Card title="Live bus">
        {trip && (trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS) ? (
          <TripTracker
            tripId={trip.id}
            stops={stops}
            highlightStopId={attendance?.stop_id ?? child.home_stop.id}
            emptyTitle="Waiting for GPS"
            emptyDescription="Live location is not available yet."
          />
        ) : (
          <EmptyState
            title={
              trip && trip.status === TripStatus.CANCELLED ? 'Trip cancelled' : 'No active trip'
            }
            description={
              trip && trip.status === TripStatus.CANCELLED
                ? trip.cancellation_reason
                  ? `Today's trip has been cancelled: ${trip.cancellation_reason}`
                  : "Today's trip has been cancelled."
                : 'The bus will appear here once today’s trip is boarding or in progress.'
            }
            action={
              <Link className="btn btn-primary" href="/parent/tracking">
                Go to live tracking
              </Link>
            }
          />
        )}
      </Card>
    </div>
  );
}
