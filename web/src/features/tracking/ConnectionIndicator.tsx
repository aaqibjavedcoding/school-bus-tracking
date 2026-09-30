import React from 'react';
import type { MapErrorReport } from '../map/types';
import type { ConnectionState } from './useLiveTripTracking';

const LABELS: Record<ConnectionState, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

export const ConnectionIndicator: React.FC<{
  state: ConnectionState;
  /**
   * The map's current verdict, or `null` when nothing is wrong.
   *
   * Two visual weights, because the two states are not the same news: while
   * the map is still retrying the badge is neutral ("Map tiles unavailable —
   * retrying…"), and only a map that has genuinely given up gets the red
   * `map-error` treatment. The raw engine codes ride along in the `title`,
   * where a support screenshot can still pick them up.
   */
  mapError?: MapErrorReport | null;
}> = React.memo(({ state, mapError = null }) => (
  <span className="connection-group">
    <span className={`connection ${state}`}>
      <span className="pulse" aria-hidden="true" />
      {LABELS[state]}
    </span>
    {mapError ? (
      <span
        className={`connection ${mapError.terminal ? 'map-error' : 'map-warning'}`}
        role="status"
        title={mapError.codes.length > 0 ? mapError.codes.join(' · ') : undefined}
      >
        {mapError.message}
      </span>
    ) : null}
  </span>
));
ConnectionIndicator.displayName = 'ConnectionIndicator';
