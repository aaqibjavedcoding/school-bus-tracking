import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS } from '@school-bus-tracking/shared-types';
import {
  ACCURACY_APPROXIMATE_METERS,
  ACCURACY_CIRCLE_MAX_METERS,
  LIVE_WINDOW_MS,
  STALE_WINDOW_MS,
  deriveTrackingPresentation,
  gpsFreshness,
} from './tracking-presentation.ts';
import { gpsSignalTier } from '../../lib/geo.ts';

/**
 * Honest live / stale / offline presentation.
 *
 * The two facts that must stay separable: **is the socket up**, and **is the
 * GPS fresh**. A connected socket proves nothing about a bus in a basement, and
 * a dropped socket does not make a 5-second-old position untrue.
 */

describe('single definition of "live"', () => {
  it('the map reads the app-wide GPS windows from the shared package', () => {
    // The observer windows are *aliases* of the shared constants, not copies of
    // the crew controller's: one definition, imported. This used to be a
    // spec-pinned equality against `SERVER_ACK_LIVE_WINDOW_MS` /
    // `SERVER_ACK_STALE_WINDOW_MS`, which left the two free to drift and only
    // detected it after the fact.
    assert.equal(LIVE_WINDOW_MS, GPS_LIVE_WINDOW_MS);
    assert.equal(STALE_WINDOW_MS, GPS_STALE_WINDOW_MS);
  });

  it('does not derive its freshness from the crew controller', () => {
    // Observer freshness (a *delivered* fix), server-acknowledgement freshness
    // (does the school have it) and local-fix freshness (does this phone have
    // GPS) are three separate questions that happen to share durations. Wiring
    // one to another would collapse them, so the observer module must not
    // import the crew status module at all.
    const source = readFileSync(
      `${process.cwd()}/src/features/map/tracking-presentation.ts`,
      'utf8',
    );
    assert.match(
      source,
      /import \{ GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS \} from '@school-bus-tracking\/shared-types';/,
    );
    assert.doesNotMatch(source, /from '\.\.\/crew\//, 'the observer must not reuse a crew window');
  });

  it('agrees with the crew signal tier on where "weak" accuracy starts', () => {
    assert.equal(gpsSignalTier(1_000, ACCURACY_APPROXIMATE_METERS + 1), 'weak');
    assert.equal(gpsSignalTier(1_000, ACCURACY_APPROXIMATE_METERS), 'good');
  });

  it('buckets freshness on those windows', () => {
    assert.equal(gpsFreshness(null), null);
    assert.equal(gpsFreshness(Number.NaN), null);
    assert.equal(gpsFreshness(0), 'live');
    assert.equal(gpsFreshness(LIVE_WINDOW_MS), 'live');
    assert.equal(gpsFreshness(LIVE_WINDOW_MS + 1), 'stale');
    assert.equal(gpsFreshness(STALE_WINDOW_MS), 'stale');
    assert.equal(gpsFreshness(STALE_WINDOW_MS + 1), 'outdated');
  });
});

describe('no location at all', () => {
  it('reports no-location and never invents a position or a motion claim', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: null,
      accuracyMeters: null,
      socketOffline: false,
    });
    assert.equal(result.state, 'no-location');
    assert.equal(result.freshness, null);
    assert.equal(result.animate, false);
    assert.equal(result.lastKnown, false, 'there is nothing known to label');
    assert.equal(result.mayReportLiveMotion, false);
    assert.equal(result.accuracyCircleMeters, null);
  });
});

describe('fresh position', () => {
  it('animates and may describe speed and direction as current', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: 4_000,
      accuracyMeters: 8,
      socketOffline: false,
    });
    assert.equal(result.state, 'live');
    assert.equal(result.animate, true);
    assert.equal(result.lastKnown, false);
    assert.equal(result.approximate, false);
    assert.equal(result.mayReportLiveMotion, true);
    assert.equal(result.accuracyCircleMeters, null);
  });
});

describe('connected socket, ageing GPS', () => {
  it('stops animation and labels the position last known once stale', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: LIVE_WINDOW_MS + 1,
      accuracyMeters: 8,
      socketOffline: false,
    });
    assert.equal(result.state, 'stale');
    assert.equal(result.animate, false, 'a stale marker must not keep sliding');
    assert.equal(result.lastKnown, true);
    assert.equal(result.mayReportLiveMotion, false, 'no live speed claim on old data');
    assert.equal(result.socketOffline, false, 'the socket is still up — say so separately');
  });

  it('escalates to outdated and keeps the position, still labelled', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: STALE_WINDOW_MS + 60_000,
      accuracyMeters: 8,
      socketOffline: false,
    });
    assert.equal(result.state, 'outdated');
    assert.equal(result.animate, false);
    assert.equal(result.lastKnown, true);
    assert.equal(result.mayReportLiveMotion, false);
  });
});

describe('disconnected socket, fresh GPS', () => {
  it('keeps the GPS verdict and reports the socket separately', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: 3_000,
      accuracyMeters: 8,
      socketOffline: true,
    });
    assert.equal(result.state, 'live', 'the position really is 3 s old');
    assert.equal(result.socketOffline, true, 'and the socket really is down');
  });

  it('the socket state never softens or sharpens the freshness verdict', () => {
    for (const socketOffline of [true, false]) {
      for (const age of [1_000, LIVE_WINDOW_MS + 1, STALE_WINDOW_MS + 1]) {
        const result = deriveTrackingPresentation({
          fixAgeMs: age,
          accuracyMeters: null,
          socketOffline,
        });
        assert.equal(
          result.freshness,
          gpsFreshness(age),
          `socket=${socketOffline} age=${age} changed the verdict`,
        );
      }
    }
  });
});

describe('weak accuracy', () => {
  it('states uncertainty instead of implying a precise road position', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: 4_000,
      accuracyMeters: 120,
      socketOffline: false,
    });
    assert.equal(result.approximate, true);
    assert.equal(result.accuracyCircleMeters, 120);
    assert.equal(result.state, 'live', 'a coarse fix can still be fresh');
  });

  it('does not draw an accuracy circle that would fill the whole map', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: 4_000,
      accuracyMeters: 5_000,
      socketOffline: false,
    });
    assert.equal(result.approximate, true, 'the uncertainty is still stated in words');
    assert.equal(result.accuracyCircleMeters, null);
    assert.ok(ACCURACY_CIRCLE_MAX_METERS === 500);
  });

  it('ignores a missing or nonsensical accuracy rather than guessing one', () => {
    for (const accuracy of [null, undefined, Number.NaN, -1]) {
      const result = deriveTrackingPresentation({
        fixAgeMs: 4_000,
        accuracyMeters: accuracy as number | null,
        socketOffline: false,
      });
      assert.equal(result.approximate, false, `accuracy=${String(accuracy)}`);
      assert.equal(result.accuracyCircleMeters, null);
    }
  });

  it('treats exactly-at-threshold accuracy as precise, matching gpsSignalTier', () => {
    const result = deriveTrackingPresentation({
      fixAgeMs: 4_000,
      accuracyMeters: ACCURACY_APPROXIMATE_METERS,
      socketOffline: false,
    });
    assert.equal(result.approximate, false);
  });
});
