import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  classifyMapLog,
  planStyleFailureReporting,
  planStyleLoadedReporting,
  shouldRetryOnNetworkChange,
} from './map-issue-policy.ts';
import { planStyleLoadFailure, STYLE_RETRY_DELAYS_MS } from './map-style-recovery.ts';

/**
 * The P0 "Map failed to load — check your network connection and map tiles,
 * with the network ON" defect, pinned.
 *
 * Three field symptoms, one spec each:
 *
 * - a healthy map that logs the way MapLibre-native always logs must raise
 *   nothing;
 * - a single flaky request must stay silent while the bounded backoff does
 *   its job, and must never call a working offline map a failure;
 * - turning the network back on must clear the notice with no restart and no
 *   manual tap.
 */

const read = (path: string): string => readFileSync(`${process.cwd()}/${path}`, 'utf8');

describe('classifyMapLog — strict allow-list, not a substring search', () => {
  it('raises nothing for a warn log merely mentioning "maplibre"', () => {
    assert.equal(classifyMapLog('warn', 'Mbgl-HttpRequest', 'maplibre: request cancelled'), null);
    assert.equal(classifyMapLog('warn', null, 'maplibre-native: using fallback renderer'), null);
    assert.equal(classifyMapLog('error', 'maplibre', 'MapLibre something happened'), null);
  });

  it('raises nothing for the lines a healthy map emits all day', () => {
    const noise: readonly [string, string | null, string][] = [
      ['warn', 'Mbgl-Style', 'unsupported style property "text-writing-mode"'],
      ['warn', 'Mbgl-SpriteLoader', 'sprite image "bus-11" not found in the atlas'],
      ['warn', 'Mbgl-HttpRequest', 'Request failed with HTTP 404: https://tiles.test/9/12/34.pbf'],
      ['error', 'Mbgl-HttpRequest', 'Request was cancelled'],
      ['warn', 'Mbgl', 'style is still loading, deferring'],
      ['warn', 'Mbgl-Glyph', 'glyph range 256-511 missing for Noto Sans Regular'],
    ];
    for (const [level, tag, message] of noise) {
      assert.equal(classifyMapLog(level, tag, message), null, `${tag ?? ''} ${message}`);
    }
  });

  it('ignores anything below warn, whatever it says', () => {
    assert.equal(classifyMapLog('info', 'Mbgl', 'Failed to load style'), null);
    assert.equal(classifyMapLog('debug', 'Mbgl', 'Failed to load style'), null);
  });

  it('still names the genuinely fatal style phrasings', () => {
    assert.equal(classifyMapLog('error', 'Mbgl', 'Failed to load style: timeout'), 'styleLoad');
    assert.equal(classifyMapLog('error', 'Mbgl', 'Unable to fetch style'), 'styleLoad');
    assert.equal(classifyMapLog('error', 'Mbgl', 'Style is not done loading'), 'styleLoad');
  });

  it('names a 4xx/5xx against the style document, but not against a tile', () => {
    assert.equal(
      classifyMapLog(
        'error',
        'Mbgl-HttpRequest',
        'Request failed with HTTP 503: https://tiles.test/styles/basic/style.json',
      ),
      'styleLoad',
    );
    assert.equal(
      classifyMapLog(
        'error',
        'Mbgl-HttpRequest',
        'Request failed with HTTP 503: https://tiles.test/9/12/34.pbf',
      ),
      null,
      'one bad tile is a grey square, not an outage',
    );
  });

  it('names a fonts-endpoint 404, but not one missing glyph range', () => {
    assert.equal(
      classifyMapLog(
        'error',
        'Mbgl-HttpRequest',
        'Request failed with HTTP 404: https://tiles.test/fonts/Noto%20Sans/0-255.pbf',
      ),
      'glyphs',
    );
    assert.equal(
      classifyMapLog('warn', 'Mbgl-Glyph', 'glyph range 1024-1279 unavailable'),
      null,
      'a few boxes are not "labels unavailable"',
    );
  });
});

describe('planStyleFailureReporting — silent while the backoff still has budget', () => {
  it('says nothing at all while retries remain', () => {
    for (let failures = 0; failures < STYLE_RETRY_DELAYS_MS.length; failures += 1) {
      const action = planStyleLoadFailure({
        showingFallback: false,
        recoveryInFlight: false,
        consecutiveFailures: failures,
      });
      assert.equal(action.kind, 'retry');
      const plan = planStyleFailureReporting({ action, showingFallback: false });
      assert.deepEqual(
        { report: [...plan.report], clear: [...plan.clear] },
        { report: [], clear: [] },
        `attempt ${failures} must not raise anything`,
      );
    }
  });

  it('reports the neutral degraded chip — never a failure — once the budget is spent', () => {
    const action = planStyleLoadFailure({
      showingFallback: false,
      recoveryInFlight: false,
      consecutiveFailures: STYLE_RETRY_DELAYS_MS.length,
    });
    assert.equal(action.kind, 'fallback');
    const plan = planStyleFailureReporting({ action, showingFallback: false });
    assert.deepEqual([...plan.report], ['offlineFallback']);
    assert.ok(!plan.report.includes('styleLoad'), 'a working offline map is not a failure');
  });

  it('stays silent while another recovery is already in flight', () => {
    const action = planStyleLoadFailure({
      showingFallback: false,
      recoveryInFlight: true,
      consecutiveFailures: 0,
    });
    assert.equal(action.kind, 'wait');
    assert.deepEqual([...planStyleFailureReporting({ action, showingFallback: false }).report], []);
  });

  it('keeps the red line for the one terminal case: the fallback itself did not load', () => {
    const action = planStyleLoadFailure({
      showingFallback: true,
      recoveryInFlight: false,
      consecutiveFailures: 99,
    });
    assert.equal(action.kind, 'wait');
    const plan = planStyleFailureReporting({ action, showingFallback: true });
    assert.deepEqual([...plan.report], ['styleLoad']);
  });
});

describe('planStyleLoadedReporting — a render is a recovery', () => {
  it('clears everything when a real online style loads', () => {
    const plan = planStyleLoadedReporting(false);
    assert.deepEqual([...plan.clear].sort(), ['offlineFallback', 'styleLoad']);
  });

  it('keeps the degraded chip when it is the fallback that loaded', () => {
    const plan = planStyleLoadedReporting(true);
    assert.deepEqual([...plan.clear], ['styleLoad']);
    assert.ok(
      !plan.clear.includes('offlineFallback'),
      'the fallback rendering is not the tiles coming back',
    );
  });
});

describe('shouldRetryOnNetworkChange — the issue clears when the network returns', () => {
  it('re-runs the pipeline on arrival at online, from either prior state', () => {
    assert.equal(shouldRetryOnNetworkChange('offline', 'online'), true);
    assert.equal(shouldRetryOnNetworkChange('unknown', 'online'), true);
  });

  it('does not re-run on anything else', () => {
    assert.equal(shouldRetryOnNetworkChange('online', 'online'), false);
    assert.equal(shouldRetryOnNetworkChange('online', 'offline'), false);
    assert.equal(shouldRetryOnNetworkChange('offline', 'unknown'), false);
  });
});

/**
 * Source-text guards for the two wiring rules that cannot be expressed as a
 * pure function, in the same style as `bus-marker-invariants.spec.ts`. The
 * hook imports React and the native module, so it cannot be loaded here.
 */
describe('use-map-style wiring', () => {
  const hook = read('src/features/map/use-map-style.ts');

  it('never raises an issue from a native log line — only records it', () => {
    const subscription = hook.slice(
      hook.indexOf('LogManager.onLog('),
      hook.indexOf('setMapRetryHandler(controller.retryStyleLoad)'),
    );
    assert.ok(subscription.length > 0, 'the LogManager subscription is still here');
    assert.match(subscription, /recordMapLog\(/, 'the raw code is kept for Help → Diagnostics');
    assert.doesNotMatch(
      subscription,
      /reportMapIssue\(/,
      'a log line may corroborate an issue, never raise one',
    );
  });

  it('re-runs the pipeline when the network comes back', () => {
    assert.match(hook, /useNetworkStatus\(\)/, 'subscribed to device connectivity');
    assert.match(hook, /shouldRetryOnNetworkChange\(/, 'the transition is decided by the policy');
    assert.match(hook, /controller\.retryStyleLoad\(\)/, 'and it re-runs the pipeline');
  });

  it('reports the failure only after the recovery plan, never before it', () => {
    const failure = hook.slice(
      hook.indexOf('function onStyleLoadFailed('),
      hook.indexOf('function notifyStyleLoaded('),
    );
    assert.ok(
      failure.indexOf('planStyleLoadFailure(') < failure.indexOf('planStyleFailureReporting('),
      'the plan is made before anything is reported',
    );
    assert.doesNotMatch(
      failure,
      /reportMapIssue\('styleLoad'\)/,
      'the terminal line is the policy\u2019s call, not an inline one',
    );
  });
});
