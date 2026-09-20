import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CHOSEN_STOP_REASONS, gpsStripActions, type GpsStripInput } from './gps-strip-action.ts';

/**
 * The driver's GPS strip must say what its one tap does. Before this module the
 * strip read "Retry" on a fresh trip where nothing had ever been tried — and a
 * driver who read that as "broken" drove with sharing off.
 */

const idle: GpsStripInput = {
  foregroundActive: false,
  backgroundActive: false,
  lastStopReason: null,
  recoveryExhausted: false,
  message: null,
};

describe('gpsStripActions', () => {
  test('a fresh trip offers "Share GPS", never "Retry"', () => {
    assert.deepEqual(gpsStripActions(idle), { primary: 'share', showRetryWhileRunning: false });
  });

  test('stops the crew member or the lifecycle chose lead back to "Share GPS"', () => {
    for (const reason of CHOSEN_STOP_REASONS) {
      assert.equal(
        gpsStripActions({ ...idle, lastStopReason: reason }).primary,
        'share',
        `"${reason}" is not a failure`,
      );
    }
  });

  test('a run that ended in a failure offers "Retry"', () => {
    for (const reason of [
      'rejected-permanent',
      'revoked',
      'trip-not-eligible',
      'headless-not-eligible',
    ]) {
      assert.equal(gpsStripActions({ ...idle, lastStopReason: reason }).primary, 'retry', reason);
    }
  });

  test('a refused start (permission denied, services off) offers "Retry"', () => {
    assert.equal(
      gpsStripActions({ ...idle, message: 'Location permission is required…' }).primary,
      'retry',
    );
  });

  test('an exhausted reconnect budget with nothing running offers "Retry"', () => {
    assert.equal(gpsStripActions({ ...idle, recoveryExhausted: true }).primary, 'retry');
  });

  test('while running the primary action is "Stop", with no extra Retry by default', () => {
    assert.deepEqual(gpsStripActions({ ...idle, foregroundActive: true }), {
      primary: 'stop',
      showRetryWhileRunning: false,
    });
    assert.equal(gpsStripActions({ ...idle, backgroundActive: true }).primary, 'stop');
  });

  test('a running run whose reconnect budget gave up gets a Retry beside Stop', () => {
    assert.deepEqual(
      gpsStripActions({ ...idle, foregroundActive: true, recoveryExhausted: true }),
      { primary: 'stop', showRetryWhileRunning: true },
    );
  });

  test('a stale message never turns a running run into a retry', () => {
    // The lifecycle clears `message` on a successful start; even if it did not,
    // "Stop" is the only honest primary action while fixes are being produced.
    assert.equal(
      gpsStripActions({ ...idle, foregroundActive: true, message: 'old' }).primary,
      'stop',
    );
  });

  test('the OS location switch being off offers Settings, not Retry', () => {
    assert.equal(
      gpsStripActions({ ...idle, servicesEnabled: false, message: 'Location services are off' })
        .primary,
      'open-settings',
      're-running the start cannot turn the switch on',
    );
  });

  test('a permanently denied foreground permission offers Settings, not Retry', () => {
    // 'denied' means "asked, refused, cannot ask again" (mapPermissionState):
    // only the OS settings screen can fix it.
    assert.equal(
      gpsStripActions({
        ...idle,
        foregroundPermission: 'denied',
        message: 'Location permission is required',
      }).primary,
      'open-settings',
    );
  });

  test('a refused-but-askable permission offers the in-app request', () => {
    // 'undetermined' covers "never asked" AND "denied once, can ask again".
    // With a failure message present the start was refused, so the tap asks
    // again in-app — the OS will still answer.
    assert.equal(
      gpsStripActions({
        ...idle,
        foregroundPermission: 'undetermined',
        message: 'Location permission is required',
      }).primary,
      'request-permission',
    );
  });

  test('an undetermined permission with no failure is a plain first start', () => {
    // Nothing was refused: "Share GPS" already asks for the permission as
    // part of starting, so a dedicated request button would be a second tap
    // for the same thing.
    assert.equal(
      gpsStripActions({ ...idle, foregroundPermission: 'undetermined' }).primary,
      'share',
    );
  });

  test('a granted permission with a failed start stays a Retry', () => {
    // Permission is not the problem (a start failed for another reason, e.g.
    // the server could not be reached): retrying the start is the right tap.
    assert.equal(
      gpsStripActions({
        ...idle,
        foregroundPermission: 'granted',
        servicesEnabled: true,
        message: 'Could not start GPS sharing.',
      }).primary,
      'retry',
    );
  });

  test('OS-side blockers win even when a run has given up reconnecting', () => {
    assert.equal(
      gpsStripActions({ ...idle, recoveryExhausted: true, servicesEnabled: false }).primary,
      'open-settings',
    );
  });

  test('repair actions do not disturb the running-run semantics', () => {
    // While fixes are being produced, nothing about permissions may turn the
    // primary tap into anything but Stop.
    assert.equal(
      gpsStripActions({
        ...idle,
        foregroundActive: true,
        servicesEnabled: false,
        foregroundPermission: 'denied',
      }).primary,
      'stop',
    );
  });
});
