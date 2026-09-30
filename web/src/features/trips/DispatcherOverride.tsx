'use client';

import React from 'react';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { TripStatusActions } from './TripStatusActions';

/** The one sentence dispatchers must read before overriding the crew. */
export const DISPATCHER_OVERRIDE_NOTE =
  'Use only when the crew device cannot act — this is recorded in the audit log';

/**
 * Collapsed-by-default disclosure holding the trip transition buttons for an
 * admin. The API still permits a SCHOOL_ADMIN status PATCH (dispatcher
 * override); this makes taking it a deliberate, two-step act.
 */
export const DispatcherOverride: React.FC<{
  trip: TripResponse;
  onUpdated: (trip: TripResponse) => void;
}> = ({ trip, onUpdated }) => (
  <details className="dispatcher-override" style={{ marginTop: '1rem' }}>
    <summary>Dispatcher override</summary>
    <p className="muted" style={{ marginTop: '0.5rem' }}>
      {DISPATCHER_OVERRIDE_NOTE}
    </p>
    <div style={{ marginTop: '0.75rem' }}>
      <TripStatusActions trip={trip} allowCancel confirmBeforeApply onUpdated={onUpdated} />
    </div>
  </details>
);
