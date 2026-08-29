import {
  deriveStatus,
  gpsStatusTone,
  statusForPermission,
  type GpsPermissionOutcome,
} from '../src/gps/status';

/**
 * The driver GPS status machine (Task 23 §E): LIVE only after the server
 * acknowledged a fix — every other state is honest about what actually
 * happened. These table tests pin that down.
 */

const granted: GpsPermissionOutcome = { kind: 'granted', background: true };
const foregroundOnly: GpsPermissionOutcome = { kind: 'foreground-only' };
const denied: GpsPermissionOutcome = { kind: 'denied' };
const servicesOff: GpsPermissionOutcome = { kind: 'services-off' };

const base = {
  started: true,
  permission: granted,
  socketConnected: true,
  networkOnline: true,
  acceptedFix: true,
};

describe('deriveStatus', () => {
  it('is stopped until started, no matter the rest', () => {
    expect(deriveStatus({ ...base, started: false })).toBe('stopped');
  });

  it('is starting while permissions are being resolved', () => {
    expect(deriveStatus({ ...base, permission: null })).toBe('starting');
  });

  it('a denied permission outranks everything but stopped', () => {
    expect(
      deriveStatus({ ...base, permission: denied, acceptedFix: false, socketConnected: false }),
    ).toBe('permission-required');
  });

  it('services-off waits (user can fix the OS switch)', () => {
    expect(deriveStatus({ ...base, permission: servicesOff, acceptedFix: true })).toBe('waiting');
  });

  it('LIVE requires a server-accepted fix over a connected socket', () => {
    expect(deriveStatus(base)).toBe('live');
    expect(deriveStatus({ ...base, acceptedFix: false })).toBe('waiting');
    expect(deriveStatus({ ...base, socketConnected: false })).toBe('offline');
    expect(deriveStatus({ ...base, networkOnline: false })).toBe('offline');
    // even a previously accepted fix cannot fake LIVE while the socket is down
    expect(deriveStatus({ ...base, networkOnline: false })).toBe('offline');
  });

  it('foreground-only permission still starts (the UI must warn)', () => {
    expect(statusForPermission(foregroundOnly)).toBe('starting');
    expect(statusForPermission(granted)).toBe('starting');
    expect(statusForPermission(denied)).toBe('permission-required');
    expect(statusForPermission(servicesOff)).toBe('waiting');
  });

  it('tones guide colour: live green, waiting amber, offline/permission red, stopped neutral', () => {
    expect(gpsStatusTone('live')).toBe('success');
    expect(gpsStatusTone('waiting')).toBe('warning');
    expect(gpsStatusTone('starting')).toBe('warning');
    expect(gpsStatusTone('offline')).toBe('danger');
    expect(gpsStatusTone('permission-required')).toBe('danger');
    expect(gpsStatusTone('stopped')).toBe('neutral');
  });
});
