/**
 * GPS status model for the driver app.
 *
 * The four states demanded by the product brief map to exactly these labels:
 *
 * ```
 * GPS: LIVE                → tracking started and accepted by the backend
 * GPS: WAITING             → started, but no accepted fix yet (no device fix,
 *                            trip not open for tracking, or first ack pending)
 * GPS: PERMISSION REQUIRED → OS/location permissions block tracking
 * GPS: OFFLINE             → tracking is on but nothing is reaching the
 *                            backend (no network / socket down)
 * ```
 *
 * Plus `stopped` once the driver ends sharing. The tracker never claims LIVE
 * unless the server accepted a fix — faked tracking is explicitly forbidden.
 */

export type GpsStatus =
  'stopped' | 'starting' | 'live' | 'waiting' | 'permission-required' | 'offline';

export const GPS_STATUS_LABELS: Record<GpsStatus, string> = {
  stopped: 'GPS: OFF',
  starting: 'GPS: WAITING',
  live: 'GPS: LIVE',
  waiting: 'GPS: WAITING',
  'permission-required': 'GPS: PERMISSION REQUIRED',
  offline: 'GPS: OFFLINE',
};

export type GpsStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function gpsStatusTone(status: GpsStatus): GpsStatusTone {
  switch (status) {
    case 'live':
      return 'success';
    case 'waiting':
    case 'starting':
      return 'warning';
    case 'permission-required':
      return 'danger';
    case 'offline':
      return 'danger';
    case 'stopped':
    default:
      return 'neutral';
  }
}

export type GpsPermissionOutcome =
  /** Foreground *and* background location granted — full background sharing. */
  | { kind: 'granted'; background: boolean }
  /** Only while-in-use: tracking works in foreground but NOT once locked. */
  | { kind: 'foreground-only' }
  /** The user must fix permissions in Settings (or accept the refusal). */
  | { kind: 'denied' }
  /** System location services are switched off (airplane/GPS toggle). */
  | { kind: 'services-off' };

export function statusForPermission(outcome: GpsPermissionOutcome): GpsStatus {
  switch (outcome.kind) {
    case 'granted':
      return 'starting';
    case 'foreground-only':
      // We can still share while foregrounded; the UI must say the OS will
      // stop us in the background, so this starts as WAITING with a warning.
      return 'starting';
    case 'denied':
      return 'permission-required';
    case 'services-off':
      return 'waiting';
    default:
      return 'permission-required';
  }
}

/**
 * Derive the visible tracker status from the parts the glue reports:
 * permission state, socket liveness and whether the backend has ever acked a
 * fix for the current run.
 */
export function deriveStatus(input: {
  started: boolean;
  permission: GpsPermissionOutcome | null;
  socketConnected: boolean;
  networkOnline: boolean;
  acceptedFix: boolean;
}): GpsStatus {
  if (!input.started) {
    return 'stopped';
  }
  if (input.permission === null) {
    return 'starting';
  }
  if (input.permission.kind === 'denied') {
    return 'permission-required';
  }
  if (input.permission.kind === 'services-off') {
    return 'waiting';
  }
  if (!input.networkOnline || !input.socketConnected) {
    return 'offline';
  }
  return input.acceptedFix ? 'live' : 'waiting';
}
