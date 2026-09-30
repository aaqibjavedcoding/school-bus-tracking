import React from 'react';
import type { ConnectionState } from './useLiveTripTracking';
import { MAP_FAILED_MESSAGE } from '../map/map-error-policy';

const LABELS: Record<ConnectionState, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

export const ConnectionIndicator: React.FC<{
  state: ConnectionState;
  /**
   * The map's current health notice, or null when the map is fine.
   *
   * The string matters: while the map is still expected to recover by itself
   * this reads "Map tiles unavailable — retrying…" and is styled as a neutral
   * chip, because a map that is retrying is not a map that has failed. Only
   * the terminal message keeps the red treatment.
   */
  mapError?: string | null;
}> = React.memo(({ state, mapError = null }) => (
  <span className="connection-group">
    <span className={`connection ${state}`}>
      <span className="pulse" aria-hidden="true" />
      {LABELS[state]}
    </span>
    {mapError ? (
      <span
        className={`connection ${mapError === MAP_FAILED_MESSAGE ? 'map-error' : 'map-degraded'}`}
        role="status"
      >
        {mapError}
      </span>
    ) : null}
  </span>
));
ConnectionIndicator.displayName = 'ConnectionIndicator';
