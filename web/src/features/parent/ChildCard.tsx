'use client';

import Link from 'next/link';
import React from 'react';
import { TripStatus } from '@school-bus-tracking/shared-types';
import type { ParentChildSummary } from '@school-bus-tracking/shared-types';
import { Badge, Card } from '../../components/ui';
import {
  boardingStatusLabel,
  boardingStatusTone,
  fullName,
  tripStatusLabel,
  tripStatusTone,
} from '../../lib/format';

/** Row of key/value details rendered responsively inside a child card. */
export const ChildFacts: React.FC<{
  items: Array<[string, React.ReactNode]>;
}> = ({ items }) => (
  <dl className="fact-list">
    {items.map(([label, value]) => (
      <div className="fact" key={label}>
        <dt>{label}</dt>
        <dd>{value || <span className="muted">—</span>}</dd>
      </div>
    ))}
  </dl>
);

/** Human-friendly "today's trip" status line with a badge. */
export const TodayTripStatus: React.FC<{ child: ParentChildSummary }> = ({ child }) => {
  const trip = child.today.trip;
  if (!trip) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        No trip scheduled for today.
      </p>
    );
  }
  if (trip.status === TripStatus.CANCELLED) {
    return (
      <Badge tone="danger">
        {tripStatusLabel(trip.status)}
        {trip.cancellation_reason ? ` — ${trip.cancellation_reason}` : ''}
      </Badge>
    );
  }
  return <Badge tone={tripStatusTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>;
};

/** Boarding + drop badges (read-only; parents can never mutate attendance). */
export const BoardingStatus: React.FC<{ child: ParentChildSummary }> = ({ child }) => {
  const status = child.today.attendance?.status ?? null;
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
      <Badge tone={boardingStatusTone(status)}>{boardingStatusLabel(status)}</Badge>
      {status === 'DROPPED' && child.today.attendance?.dropped_at ? (
        <span className="muted">
          dropped{' '}
          {new Date(child.today.attendance.dropped_at).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      ) : null}
    </div>
  );
};

/**
 * Reusable parent-facing child card (dashboard + "My children").
 */
export const ChildCard: React.FC<{ child: ParentChildSummary }> = ({ child }) => (
  <Card className="child-card">
    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0 }}>{fullName(child)}</h2>
      <Link className="btn btn-secondary" href={`/parent/children/${child.id}`}>
        View trip
      </Link>
    </div>
    <p className="muted">
      {child.admission_number}
      {child.grade_level ? ` · ${child.grade_level}` : ''}
    </p>
    <ChildFacts
      items={[
        ['Status', <TodayTripStatus key="s" child={child} />],
        ['Boarding', <BoardingStatus key="b" child={child} />],
        [
          'Bus',
          child.today.bus
            ? `${child.today.bus.bus_number ?? ''} ${child.today.bus.registration_number}`.trim()
            : null,
        ],
        ['Route', child.home_stop.route_code ?? child.home_stop.route_name ?? null],
        [
          'Home stop',
          child.home_stop.name
            ? child.home_stop.sequence_number
              ? `${child.home_stop.sequence_number}. ${child.home_stop.name}`
              : child.home_stop.name
            : null,
        ],
      ]}
    />
  </Card>
);
