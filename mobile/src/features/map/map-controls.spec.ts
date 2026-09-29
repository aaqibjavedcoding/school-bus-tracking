import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_ZOOM_MAX,
  MAP_ZOOM_MIN,
  MAP_ZOOM_STEP,
  clampMapZoom,
  driverFollowControls,
  zoomLimits,
  zoomStepTarget,
  type DriverFollowControlsInput,
} from './map-controls.ts';

/**
 * What the driver's on-map controls may offer, and what they must never be.
 *
 * The two invariants this suite carries, both taken straight from the field
 * report:
 *
 * 1. **No control is ever a silent no-op.** A zoom button at the bound reports
 *    "nothing to do" as data (`null` / `canZoomIn: false`), and the follow
 *    primary with no fix comes back `disabled` with a label that says why —
 *    never an enabled button whose tap does nothing.
 * 2. **The primary never means the opposite of its label.** "Follow bus"
 *    re-centres and re-enables follow in every state; switching follow *off*
 *    is a separate, explicit control. The old block toggled follow off from
 *    the primary while following, which is what made it read as broken.
 */

describe('zoom buttons — step and bounds', () => {
  const cases: Array<{
    name: string;
    zoom: number | null;
    direction: 'in' | 'out';
    expected: number | null;
  }> = [
    { name: 'a plain zoom in steps one whole level', zoom: 14, direction: 'in', expected: 15 },
    { name: 'a plain zoom out steps one whole level', zoom: 14, direction: 'out', expected: 13 },
    { name: 'a fractional zoom keeps its fraction', zoom: 13.5, direction: 'in', expected: 14.5 },
    { name: 'zooming in clamps at the maximum', zoom: MAP_ZOOM_MAX - 0.5, direction: 'in', expected: MAP_ZOOM_MAX },
    { name: 'at the maximum there is nothing to do', zoom: MAP_ZOOM_MAX, direction: 'in', expected: null },
    { name: 'past the maximum there is still nothing to do', zoom: 22, direction: 'in', expected: null },
    { name: 'zooming out clamps at the minimum', zoom: MAP_ZOOM_MIN + 0.4, direction: 'out', expected: MAP_ZOOM_MIN },
    { name: 'at the minimum there is nothing to do', zoom: MAP_ZOOM_MIN, direction: 'out', expected: null },
    { name: 'an unknown zoom cannot be stepped', zoom: null, direction: 'in', expected: null },
    { name: 'a non-finite zoom cannot be stepped', zoom: Number.NaN, direction: 'out', expected: null },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.equal(zoomStepTarget(testCase.zoom, testCase.direction), testCase.expected);
    });
  }

  it('uses one whole zoom level as the step', () => {
    assert.equal(MAP_ZOOM_STEP, 1);
  });

  it('clamps any level into the buttons’ range', () => {
    assert.equal(clampMapZoom(0), MAP_ZOOM_MIN);
    assert.equal(clampMapZoom(30), MAP_ZOOM_MAX);
    assert.equal(clampMapZoom(15), 15);
    assert.equal(clampMapZoom(Number.NaN), MAP_ZOOM_MIN);
  });
});

describe('zoom buttons — enabled state', () => {
  it('keeps both buttons live before the first region report', () => {
    // The engine has not said where it is yet; greying out a control the
    // driver can see is applicable would be worse than resolving on press.
    assert.deepEqual(zoomLimits(null), { canZoomIn: true, canZoomOut: true });
  });

  it('greys out only the direction that has run out', () => {
    assert.deepEqual(zoomLimits(MAP_ZOOM_MAX), { canZoomIn: false, canZoomOut: true });
    assert.deepEqual(zoomLimits(MAP_ZOOM_MIN), { canZoomIn: true, canZoomOut: false });
    assert.deepEqual(zoomLimits(15), { canZoomIn: true, canZoomOut: true });
  });
});

function input(overrides: Partial<DriverFollowControlsInput> = {}): DriverFollowControlsInput {
  return { hasFix: true, followEnabled: true, exploring: false, ...overrides };
}

describe('follow controls — the primary is always "Follow bus"', () => {
  const states: Array<{ name: string; input: DriverFollowControlsInput }> = [
    { name: 'following', input: input() },
    { name: 'following but exploring', input: input({ exploring: true }) },
    { name: 'follow switched off', input: input({ followEnabled: false }) },
    { name: 'follow off and exploring', input: input({ followEnabled: false, exploring: true }) },
  ];

  for (const state of states) {
    it(`reads "Follow bus" and is tappable while ${state.name}`, () => {
      const view = driverFollowControls(state.input);
      assert.equal(view.primary.labelKey, 'map.followBus');
      assert.equal(view.primary.disabled, false);
    });
  }

  it('marks the primary active only while the camera is actually on the bus', () => {
    assert.equal(driverFollowControls(input()).primary.active, true);
    assert.equal(driverFollowControls(input({ exploring: true })).primary.active, false);
    assert.equal(driverFollowControls(input({ followEnabled: false })).primary.active, false);
  });
});

describe('follow controls — no GPS fix', () => {
  it('disables the primary and says why instead of offering a dead button', () => {
    const view = driverFollowControls(input({ hasFix: false }));
    assert.equal(view.primary.disabled, true);
    assert.equal(view.primary.labelKey, 'map.followWaitingFix');
    assert.equal(view.primary.active, false);
    assert.equal(view.waitingForFix, true);
  });

  it('hides the follow switch — there is nothing to follow or pause', () => {
    const view = driverFollowControls(input({ hasFix: false }));
    assert.equal(view.secondary.visible, false);
  });

  it('stays disabled whatever the follow switch and camera mode say', () => {
    for (const followEnabled of [true, false]) {
      for (const exploring of [true, false]) {
        const view = driverFollowControls(input({ hasFix: false, followEnabled, exploring }));
        assert.equal(view.primary.disabled, true);
        assert.equal(view.stateKey, 'map.noFixA11y');
      }
    }
  });
});

describe('follow controls — the secondary switch', () => {
  it('shows the live "on" state as the tappable way to pause follow', () => {
    const view = driverFollowControls(input());
    assert.deepEqual(view.secondary, {
      visible: true,
      labelKey: 'map.followOn',
      disabled: false,
    });
  });

  it('shows "off" as a state, not as a second way to turn follow back on', () => {
    // Two controls that both re-enable follow is the confusion this replaced.
    const view = driverFollowControls(input({ followEnabled: false }));
    assert.deepEqual(view.secondary, {
      visible: true,
      labelKey: 'map.followOff',
      disabled: true,
    });
    assert.equal(view.primary.labelKey, 'map.followBus', 'the primary is the way back on');
  });

  it('keeps showing "on" while exploring — the switch is on, the camera is the user’s', () => {
    const view = driverFollowControls(input({ exploring: true }));
    assert.equal(view.secondary.labelKey, 'map.followOn');
    assert.equal(view.stateKey, 'map.exploringA11y');
  });
});

describe('follow controls — the spoken state', () => {
  const cases: Array<{ input: DriverFollowControlsInput; expected: string }> = [
    { input: input(), expected: 'map.followingA11y' },
    { input: input({ exploring: true }), expected: 'map.exploringA11y' },
    { input: input({ followEnabled: false }), expected: 'map.followOffA11y' },
    { input: input({ followEnabled: false, exploring: true }), expected: 'map.followOffA11y' },
    { input: input({ hasFix: false }), expected: 'map.noFixA11y' },
  ];

  for (const testCase of cases) {
    it(`speaks ${testCase.expected}`, () => {
      assert.equal(driverFollowControls(testCase.input).stateKey, testCase.expected);
    });
  }
});
