'use client';

import React from 'react';
import { TripStatus, type TripResponse } from '@school-bus-tracking/shared-types';
import {
  buildTripLifecycleSteps,
  tripLifecycleCancellation,
} from '@school-bus-tracking/validation';
import { formatDateTime, tripStatusLabel } from '../../lib/format';

/**
 * Read-only lifecycle timeline for the admin trip detail page.
 *
 * Dispatchers used to see the crew's Boarding / Start / Cancel buttons at the
 * top of a freshly scheduled trip and pressed them by accident. They now read
 * the trip's real progress here; acting on it is behind the explicit
 * `DispatcherOverride` disclosure below.
 */
export const TripLifecycleTimeline: React.FC<{ trip: TripResponse }> = ({ trip }) => {
  const steps = buildTripLifecycleSteps(trip);
  const cancellation = tripLifecycleCancellation(trip);

  return (
    <ol className="trip-lifecycle" aria-label="Trip lifecycle">
      {steps.map((step) => (
        <li
          key={step.status}
          className={[
            'trip-lifecycle-step',
            step.reached ? 'is-reached' : '',
            step.current ? 'is-current' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={step.current ? 'step' : undefined}
        >
          <span className="trip-lifecycle-dot" aria-hidden="true" />
          <span className="trip-lifecycle-label">{tripStatusLabel(step.status)}</span>
          <span className="trip-lifecycle-time muted">{step.at ? formatDateTime(step.at) : '—'}</span>
        </li>
      ))}
      {cancellation ? (
        <li className="trip-lifecycle-step is-cancelled" aria-current="step">
          <span className="trip-lifecycle-dot" aria-hidden="true" />
          <span className="trip-lifecycle-label">{tripStatusLabel(TripStatus.CANCELLED)}</span>
          <span className="trip-lifecycle-time muted">
            {cancellation.at ? formatDateTime(cancellation.at) : '—'}
            {cancellation.reason ? ` · ${cancellation.reason}` : ''}
          </span>
        </li>
      ) : null}
    </ol>
  );
};
