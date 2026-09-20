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
});
