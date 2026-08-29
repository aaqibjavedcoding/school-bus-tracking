'use client';

import React from 'react';
import type {
  StopResponse,
  TripEtaResponse,
  TripStatus,
  TripStopArrivedEvent,
  TripTrackingState,
} from '@school-bus-tracking/shared-types';
import {
  formatDistanceMeters,
  formatEtaMinutes,
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

/**
 * Task 22 status panel: latest arrived stop, next stop, distance and the
 * approximate ETA. Everything comes from the server-computed ETA summary
 * (REST snapshot + `trip:eta:update` pushes) — the client never invents a
 * distance or an ETA on its own.
 */
const EtaPanel: React.FC<{
  fix: LiveFix | null;
  eta: TripEtaResponse | null;
  lastArrival: TripStopArrivedEvent | null;
}> = ({ fix, eta, lastArrival }) => {
  const nextStop = eta?.next_stop ?? null;
  const currentStop = eta?.current_stop ?? null;
  const arrivedStopName = currentStop?.stop_name ?? lastArrival?.stop_name ?? null;
  const hasEta = eta !== null && eta.eta_available;

  return (
    <div className="card" style={{ marginTop: '0.75rem' }}>
      {!fix ? (
        <p>Waiting for GPS…</p>
      ) : nextStop ? (
        <>
          <p>
            🚌 Bus is{' '}
            {nextStop.distance_meters !== null
              ? `${formatDistanceMeters(nextStop.distance_meters)} away`
              : 'approaching'}
          </p>
          <p>📍 Next Stop: {nextStop.stop_name}</p>
          <p>⏱ ETA: {formatEtaMinutes(nextStop.eta_minutes) ?? 'ETA unavailable'}</p>
        </>
      ) : (
        <p>All stops on this trip have been reached.</p>
      )}
      {arrivedStopName ? <p>✅ Current stop: {arrivedStopName}</p> : null}
      {fix && !hasEta ? (
        <p className="muted" style={{ marginTop: '0.35rem' }}>
          ETA unavailable.
        </p>
      ) : null}
      {hasEta && nextStop === null && currentStop === null ? (
        <p className="muted" style={{ marginTop: '0.35rem' }}>
          Waiting for the crew device to share a location.
        </p>
      ) : null}
    </div>
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
  eta: TripEtaResponse | null;
  lastArrival: TripStopArrivedEvent | null;
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
  eta,
  lastArrival,
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
        <EtaPanel fix={fix} eta={eta} lastArrival={lastArrival} />
      </div>
    </div>
  );
};
