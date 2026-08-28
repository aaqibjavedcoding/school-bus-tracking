import React from 'react';
import type { ConnectionState } from './useLiveTripTracking';

const LABELS: Record<ConnectionState, string> = {
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
};

export const ConnectionIndicator: React.FC<{ state: ConnectionState }> = ({ state }) => (
  <span className={`connection ${state}`}>
    <span className="pulse" aria-hidden="true" />
    {LABELS[state]}
  </span>
);
