import React from 'react';
import type { ConnectionState } from './useLiveTripTracking';

const LABELS: Record<ConnectionState, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

export const ConnectionIndicator: React.FC<{
  state: ConnectionState;
  /** True when the map itself failed (style/tile/glyph outage, WebGL loss). */
  mapError?: boolean;
}> = React.memo(({ state, mapError = false }) => (
  <span className="connection-group">
    <span className={`connection ${state}`}>
      <span className="pulse" aria-hidden="true" />
      {LABELS[state]}
    </span>
    {mapError ? (
      <span className="connection map-error" role="status">
        Map failed to load
      </span>
    ) : null}
  </span>
));
ConnectionIndicator.displayName = 'ConnectionIndicator';
