'use client';

import React from 'react';
import type {
  StopResponse,
  TripStatus,
  TripTrackingState,
} from '@school-bus-tracking/shared-types';
import {
  formatRelative,
  formatSpeedKmh,
  trackingStateLabel,
  tripStatusLabel,
} from '../../lib/format';
import { MapView } from '../map/MapView';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useLiveTripTracking, type ConnectionState, type LiveFix } from './useLiveTripTracking';

export const TripTracker: React.FC<{
  tripId: string | null;
  stops?: StopResponse[];
  highlightStopId?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}> = ({
  tripId,
  stops,
  highlightStopId,
  emptyTitle = 'Select a trip to track',
  emptyDescription = 'Live GPS from the crew device appears here over OpenStreetMap.',
}) => {
  const live = useLiveTripTracking(tripId);
  return (
    <TripTrackerView
      tripId={tripId}
      stops={stops}
      highlightStopId={highlightStopId}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      {...live}
    />
  );
};

export const TripTrackerView: React.FC<{
  tripId: string | null;
  connection: ConnectionState;
  fix: LiveFix | null;
  trackingState: TripTrackingState | null;
  tripStatus: TripStatus | null;
  noLocationYet: boolean;
  error: string | null;
  stops?: StopResponse[];
  highlightStopId?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
}> = ({
  tripId,
  connection,
  fix,
  trackingState,
  tripStatus,
  noLocationYet,
  error,
  stops,
  highlightStopId,
  emptyTitle = 'Select a trip to track',
  emptyDescription = 'Live GPS from the crew device appears here over OpenStreetMap.',
}) => {
  if (!tripId) {
    return (
      <div className="map-shell">
        <div className="empty">
          <h3>{emptyTitle}</h3>
          <p className="muted">{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <MapView key={tripId} fix={fix} stops={stops} highlightStopId={highlightStopId} />
      <div className="map-overlay">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <ConnectionIndicator state={connection} />
            {tripStatus ? <span className="muted">{tripStatusLabel(tripStatus)}</span> : null}
          </div>
          <p className="muted" style={{ marginTop: '0.45rem' }}>
            {trackingStateLabel(trackingState)}
          </p>
          {error ? <p className="field-error">{error}</p> : null}
          {connection === 'offline' ? (
            <p className="muted">You are offline. The last known position stays on the map.</p>
          ) : null}
          {connection === 'reconnecting' ? (
            <p className="muted">Reconnecting to live tracking…</p>
          ) : null}
          {noLocationYet && !fix ? (
            <p className="muted">No GPS yet. Waiting for the crew device to share a location.</p>
          ) : null}
          {fix ? (
            <p className="muted">
              {formatRelative(fix.received_at)} · {formatSpeedKmh(fix.speed)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
};
