import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { createStyleController, type StyleControllerPorts } from './map-style-controller.ts';
import { getMapIssues, reportMapIssue, resetMapIssuesForTests } from './map-diagnostics.ts';
import { OFFLINE_FALLBACK_MAP_STYLE, type GlyphUrlTransform } from './map-style.ts';

/**
 * The style pipeline's lifecycle, driven end to end with no native module,
 * no real network and no real timers.
 *
 * What is being protected is the honesty of the map's status lines:
 *
 * - a retry that has not run yet is **not** a failure the driver may read
 *   about (the old code reported `styleLoad` before the first re-set, which
 *   flatly contradicted the bounded-backoff design);
 * - the bundled offline fallback rendering is a **working map**, so it gets
 *   the neutral `styleOffline` chip, not the red line;
 * - red (`styleLoad`) is reserved for the engine failing to render even a
 *   style that needs zero network;
 * - a log line may only **corroborate**;
 * - the network coming back **clears** the issue, with no restart and no tap.
 */

const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

const STYLE_JSON = {
  version: 8,
  name: 'test',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    { id: 'label', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } },
  ],
};

interface Harness {
  ports: StyleControllerPorts;
  styles: unknown[];
  transforms: GlyphUrlTransform[];
  fetched: string[];
  scheduled: Array<{ callback: () => void; delayMs: number }>;
  /** Runs every pending scheduled callback, in order. */
  flushTimers(): void;
  /** Airplane mode on/off, without touching anything else. */
  setNetworkUp(up: boolean): void;
}

function makeHarness(options: { styleFails?: boolean; glyphsOk?: boolean } = {}): Harness {
  const styles: unknown[] = [];
  const transforms: GlyphUrlTransform[] = [];
  const fetched: string[] = [];
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  let styleFails = options.styleFails ?? false;
  const glyphsOk = options.glyphsOk ?? true;

  const ports: StyleControllerPorts = {
    setMapStyle: (style) => styles.push(style),
    addUrlTransform: (transform) => transforms.push(transform),
    fetchResource: async (url) => {
      fetched.push(url);
      if (url.includes('/fonts/')) {
        return { ok: glyphsOk, status: glyphsOk ? 200 : 404, json: async () => ({}) };
      }
      if (styleFails) throw new Error('network down');
      return { ok: true, status: 200, json: async () => STYLE_JSON };
    },
    // No real waiting: the backoff schedule is `map-style-recovery.spec.ts`'s
    // subject, not this file's.
    sleep: async () => {},
    schedule: (callback, delayMs) => {
      const entry = { callback, delayMs };
      scheduled.push(entry);
      return entry;
    },
    cancel: (handle) => {
      const index = scheduled.indexOf(handle as { callback: () => void; delayMs: number });
      if (index >= 0) scheduled.splice(index, 1);
    },
  };

  return {
    ports,
    styles,
    transforms,
    fetched,
    scheduled,
    flushTimers() {
      const pending = scheduled.splice(0, scheduled.length);
      for (const entry of pending) entry.callback();
    },
    setNetworkUp(up) {
      styleFails = !up;
    },
  };
}

function controllerFor(harness: Harness) {
  const controller = createStyleController(harness.ports);
  controller.styleUrl = STYLE_URL;
  controller.resume();
  return controller;
}

beforeEach(() => {
  resetMapIssuesForTests();
});

describe('the happy path', () => {
  it('fetches, repairs, registers the fontstack rewrites and reports nothing', async () => {
    const harness = makeHarness();
    const controller = controllerFor(harness);

    await controller.runPipeline();

    assert.deepEqual(harness.fetched[0], STYLE_URL);
    assert.equal(harness.styles.length, 1, 'the inspected object is handed to the map');
    assert.deepEqual(
      harness.transforms.map((transform) => transform.replace),
      ['Noto%20Sans%20Regular'],
    );
    assert.deepEqual(getMapIssues(), [], 'a working map says nothing at all');
  });

  it('clears a stale glyph line when the probe answers', async () => {
    reportMapIssue('glyphs');
    const controller = controllerFor(makeHarness());

    await controller.runPipeline();

    assert.deepEqual(getMapIssues(), []);
  });
});

describe('silence during retries (the bounded-backoff contract)', () => {
  it('says nothing at all on the first engine failure', () => {
    const harness = makeHarness();
    const controller = controllerFor(harness);

    controller.onStyleLoadFailed();

    assert.deepEqual(getMapIssues(), [], 'a retry that has not run yet is not a failure');
    assert.equal(harness.scheduled.length, 1, 'but a re-set must be scheduled');
    assert.equal(harness.scheduled[0].delayMs, 2_000);
  });

  it('stays silent across the whole retry budget, then shows the neutral chip', async () => {
    const harness = makeHarness();
    const controller = controllerFor(harness);
    // A style did load once, so each retry is a re-set of that object rather
    // than a fresh fetch — the engine-failure path this test is about.
    await controller.runPipeline();
    const stylesAfterBoot = harness.styles.length;

    for (const expectedDelay of [2_000, 5_000, 15_000]) {
      controller.onStyleLoadFailed();
      assert.deepEqual(getMapIssues(), [], `still silent before the ${expectedDelay} ms re-set`);
      assert.equal(harness.scheduled[0].delayMs, expectedDelay);
      harness.flushTimers();
    }
    assert.equal(
      harness.styles.length,
      stylesAfterBoot + 3,
      'each retry must be a real re-set, with a fresh nonce the bridge can see',
    );

    // Budget spent: the map drops to the bundled offline base style.
    controller.onStyleLoadFailed();

    assert.equal(controller.isShowingFallback(), true);
    assert.equal(harness.styles.at(-1), OFFLINE_FALLBACK_MAP_STYLE);
    assert.deepEqual(getMapIssues(), ['styleOffline'], 'neutral, retryable — not a red failure');
  });

  it('drops to the neutral chip when the JS fetch budget is spent', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);

    await controller.runPipeline();

    assert.equal(harness.styles.at(-1), OFFLINE_FALLBACK_MAP_STYLE);
    assert.deepEqual(getMapIssues(), ['styleOffline']);
    assert.ok(!getMapIssues().includes('styleLoad'), 'a working fallback is not "failed to load"');
  });
});

describe('the red line is the terminal state only', () => {
  it('appears when the engine cannot render even the zero-network fallback', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);

    await controller.runPipeline();
    assert.deepEqual(getMapIssues(), ['styleOffline']);

    // The fallback is on screen and the engine STILL says the style failed.
    controller.onStyleLoadFailed();

    assert.deepEqual(getMapIssues(), ['styleOffline', 'styleLoad']);
  });

  it('never appears while a recovery is merely in flight', () => {
    const harness = makeHarness();
    const controller = controllerFor(harness);

    controller.onStyleLoadFailed(); // schedules a re-set
    controller.onStyleLoadFailed(); // recovery in flight → `wait`

    assert.deepEqual(getMapIssues(), []);
  });
});

describe('a log line may only corroborate', () => {
  it('raises nothing on its own', () => {
    const controller = controllerFor(makeHarness());

    controller.corroborateLog('styleLoad');
    controller.corroborateLog('glyphs');

    assert.deepEqual(getMapIssues(), [], 'the log bridge is not a diagnosis');
  });

  it('confirms a conclusion the pipeline already reached', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);
    await controller.runPipeline();

    controller.corroborateLog('styleLoad');

    assert.deepEqual(getMapIssues(), ['styleOffline'], 'it may confirm, never escalate');
  });
});

describe('automatic recovery', () => {
  it('clears the lines when a real style finishes loading', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);
    await controller.runPipeline();
    controller.onStyleLoadFailed(); // terminal too, for good measure
    assert.deepEqual(getMapIssues(), ['styleOffline', 'styleLoad']);

    // The pipeline got a real style in; then the engine rendered it.
    harness.setNetworkUp(true);
    await controller.runPipeline();
    controller.notifyStyleLoaded();

    assert.deepEqual(getMapIssues(), []);
  });

  it('clears the lines when a frame renders completely', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);
    await controller.runPipeline();
    harness.setNetworkUp(true);
    await controller.runPipeline();

    controller.notifyTilesRendered();

    assert.deepEqual(getMapIssues(), []);
  });

  it('keeps the offline chip while the fallback itself is what rendered', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);
    await controller.runPipeline();
    controller.onStyleLoadFailed();
    assert.deepEqual(getMapIssues(), ['styleOffline', 'styleLoad']);

    // The fallback rendering is not the tiles coming back: the red terminal
    // line goes, the honest "offline map" chip stays.
    controller.notifyStyleLoaded();

    assert.deepEqual(getMapIssues(), ['styleOffline']);
  });

  it('clears the issue when the network returns — no restart, no tap', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);

    // Airplane mode: the whole budget is spent and the chip is up.
    await controller.runPipeline();
    assert.deepEqual(getMapIssues(), ['styleOffline']);

    // Network back. `useNetworkStatus` reports the transition; nothing else
    // happens — no remount, no user gesture.
    harness.setNetworkUp(true);
    controller.onNetworkRestored();
    await new Promise((resolve) => setImmediate(resolve));
    controller.notifyStyleLoaded();

    assert.deepEqual(getMapIssues(), [], 'the line must clear itself');
    assert.equal(controller.isShowingFallback(), false);
    assert.notEqual(harness.styles.at(-1), OFFLINE_FALLBACK_MAP_STYLE);
  });

  it('does not spend the radio when nothing is wrong', async () => {
    const harness = makeHarness();
    const controller = controllerFor(harness);
    await controller.runPipeline();
    const fetchesAfterBoot = harness.fetched.length;

    controller.onNetworkRestored();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(harness.fetched.length, fetchesAfterBoot, 'a healthy map needs no re-fetch');
  });

  it('the retry affordance re-runs the whole pipeline', async () => {
    const harness = makeHarness({ styleFails: true });
    const controller = controllerFor(harness);
    await controller.runPipeline();
    assert.equal(controller.isShowingFallback(), true);

    harness.setNetworkUp(true);
    controller.retryNow();
    await new Promise((resolve) => setImmediate(resolve));
    controller.notifyStyleLoaded();

    assert.equal(controller.isShowingFallback(), false);
    assert.deepEqual(getMapIssues(), []);
  });
});

describe('disposal', () => {
  it('stops every scheduled thing and reports nothing afterwards', () => {
    const harness = makeHarness();
    const controller = controllerFor(harness);
    controller.onStyleLoadFailed();
    assert.equal(harness.scheduled.length, 1);

    controller.dispose();

    assert.equal(harness.scheduled.length, 0, 'the pending re-set must be cancelled');
    controller.onStyleLoadFailed();
    controller.corroborateLog('styleLoad');
    controller.onNetworkRestored();
    assert.deepEqual(getMapIssues(), []);
  });
});
