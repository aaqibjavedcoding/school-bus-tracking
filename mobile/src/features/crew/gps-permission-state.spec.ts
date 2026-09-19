import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_ONLY_ISSUES,
  evaluateGpsPermissions,
  evaluatePermissionRequest,
  isReducedAccuracy,
  isRequestableIssue,
  locationAccuracyAuthorization,
  mapPermissionState,
} from './gps-permission-state.ts';

/**
 * Permission evaluation — including the exact bug this patch fixes: requesting
 * the background permission and then reporting success **without reading the
 * answer**. A driver who allows "While using the app" and refuses "Allow all the
 * time" must be told background tracking is not on.
 */

const granted = (extra: Record<string, unknown> = {}) => ({
  granted: true,
  canAskAgain: true,
  status: 'granted',
  ...extra,
});
const denied = (canAskAgain: boolean) => ({
  granted: false,
  canAskAgain,
  status: 'denied',
});

describe('mapPermissionState', () => {
  it('never turns an unanswered query into a grant', () => {
    assert.equal(mapPermissionState(null), 'unavailable');
    assert.equal(mapPermissionState(undefined), 'unavailable');
  });

  it('separates "denied, ask again" from "denied for good"', () => {
    assert.equal(mapPermissionState(denied(true)), 'undetermined');
    assert.equal(mapPermissionState(denied(false)), 'denied');
    assert.equal(mapPermissionState(granted()), 'granted');
    assert.equal(mapPermissionState({ granted: false, status: 'undetermined' }), 'undetermined');
  });
});

describe('locationAccuracyAuthorization', () => {
  it('reads the iOS 14+ accuracy authorization', () => {
    assert.equal(locationAccuracyAuthorization(granted({ ios: { accuracy: 'full' } })), 'full');
    assert.equal(locationAccuracyAuthorization(granted({ ios: { accuracy: 'reduced' } })), 'reduced');
  });

  it('reads the Android 12+ accuracy provider', () => {
    assert.equal(locationAccuracyAuthorization(granted({ android: { accuracy: 'fine' } })), 'full');
    assert.equal(
      locationAccuracyAuthorization(granted({ android: { accuracy: 'coarse' } })),
      'reduced',
    );
    assert.equal(locationAccuracyAuthorization(granted({ android: { accuracy: 'none' } })), 'reduced');
  });

  it('reports unknown (not full) when the platform says nothing', () => {
    assert.equal(locationAccuracyAuthorization(granted()), 'unknown');
    assert.equal(locationAccuracyAuthorization(null), 'unknown');
    assert.equal(isReducedAccuracy('unknown'), false, 'unknown is not reported as reduced');
    assert.equal(isReducedAccuracy('reduced'), true);
  });
});

describe('evaluateGpsPermissions', () => {
  it('is ready when foreground is granted and background is not required', () => {
    const result = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: granted({ android: { accuracy: 'fine' } }),
      backgroundRequired: false,
    });
    assert.equal(result.issue, 'none');
    assert.equal(result.ready, true);
    assert.equal(result.backgroundPermission, 'unavailable');
  });

  it('reports the location switch being off above everything else', () => {
    const result = evaluateGpsPermissions({
      servicesEnabled: false,
      foreground: granted(),
      background: granted(),
      backgroundRequired: true,
    });
    assert.equal(result.issue, 'location_services_disabled');
    assert.equal(result.ready, false);
    assert.equal(result.needsSettings, true);
  });

  it('distinguishes a denial that can be re-requested from a permanent one', () => {
    const askable = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: denied(true),
      backgroundRequired: false,
    });
    assert.equal(askable.issue, 'permission_denied');
    assert.equal(askable.canRequestAgain, true);
    assert.equal(askable.needsSettings, false);
    assert.equal(isRequestableIssue(askable.issue), true);

    const permanent = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: denied(false),
      backgroundRequired: false,
    });
    assert.equal(permanent.issue, 'permission_permanently_denied');
    assert.equal(permanent.needsSettings, true);
    assert.ok(SETTINGS_ONLY_ISSUES.includes('permission_permanently_denied'));
  });

  it('reports approximate location as its own blocking issue', () => {
    const result = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: granted({ ios: { scope: 'always', accuracy: 'reduced' } }),
      backgroundRequired: false,
    });
    assert.equal(result.issue, 'location_accuracy_reduced');
    assert.equal(result.ready, false, 'a coarse fix cannot confirm a 100 m geofence');
    assert.equal(result.needsSettings, true);
  });

  it('reports a denied background permission even though foreground is granted', () => {
    const result = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: granted({ android: { accuracy: 'fine' } }),
      background: denied(false),
      backgroundRequired: true,
    });
    assert.equal(result.issue, 'background_permission_denied');
    assert.equal(result.ready, false);
    assert.equal(result.foregroundPermission, 'granted');
    assert.equal(result.backgroundPermission, 'denied');
  });

  it('reports background access that the device does not offer', () => {
    const result = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: granted({ android: { accuracy: 'fine' } }),
      background: null,
      backgroundRequired: true,
    });
    assert.equal(result.issue, 'background_permission_unavailable');
    assert.equal(result.needsSettings, false, 'no settings trip can fix an absent capability');
  });

  it('does not demand background access nobody consented to', () => {
    const result = evaluateGpsPermissions({
      servicesEnabled: true,
      foreground: granted({ android: { accuracy: 'fine' } }),
      background: denied(false),
      backgroundRequired: false,
    });
    assert.equal(result.issue, 'none', 'foreground-only sharing is a valid, honest state');
    assert.equal(result.ready, true);
  });
});

describe('evaluatePermissionRequest (the fix)', () => {
  it('does NOT clear the issue when the background request was refused', () => {
    const result = evaluatePermissionRequest({
      servicesEnabled: true,
      foregroundResult: granted({ android: { accuracy: 'fine' } }),
      backgroundResult: denied(false),
      backgroundRequested: true,
      backgroundRequired: true,
    });
    assert.equal(result.issue, 'background_permission_denied');
    assert.equal(result.ready, false, 'the old code reported success here');
  });

  it('reports success only when both required results are granted', () => {
    const result = evaluatePermissionRequest({
      servicesEnabled: true,
      foregroundResult: granted({ android: { accuracy: 'fine' } }),
      backgroundResult: granted(),
      backgroundRequested: true,
      backgroundRequired: true,
    });
    assert.equal(result.issue, 'none');
    assert.equal(result.ready, true);
  });

  it('reports a foreground grant as a foreground grant when background was not asked', () => {
    const result = evaluatePermissionRequest({
      servicesEnabled: true,
      foregroundResult: granted({ android: { accuracy: 'fine' } }),
      backgroundResult: null,
      backgroundRequested: false,
      backgroundRequired: true,
    });
    assert.equal(result.issue, 'none');
    assert.equal(
      result.backgroundPermission,
      'unavailable',
      'nothing was asked, so nothing may be reported as granted',
    );
  });

  it('still reports a refused foreground request', () => {
    const result = evaluatePermissionRequest({
      servicesEnabled: true,
      foregroundResult: denied(false),
      backgroundRequested: false,
      backgroundRequired: false,
    });
    assert.equal(result.issue, 'permission_permanently_denied');
    assert.equal(result.ready, false);
  });

  it('reports a request that returned nothing (platform refused to answer)', () => {
    const result = evaluatePermissionRequest({
      servicesEnabled: true,
      foregroundResult: null,
      backgroundRequested: true,
      backgroundRequired: true,
    });
    assert.equal(result.foregroundPermission, 'unavailable');
    assert.equal(result.ready, false);
  });

  it('reports the location switch being off after a request', () => {
    const result = evaluatePermissionRequest({
      servicesEnabled: false,
      foregroundResult: granted(),
      backgroundRequested: false,
      backgroundRequired: false,
    });
    assert.equal(result.issue, 'location_services_disabled');
  });
});
