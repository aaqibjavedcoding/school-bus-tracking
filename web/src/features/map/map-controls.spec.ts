import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPASS_HIDDEN_BEARING_EPSILON_DEG,
  COMPASS_RESET_NORTH_DURATION_MS,
  compassNeedleRotationDeg,
  createCompassControl,
  normalizeBearingDeg,
  resetNorthDurationMs,
  shouldShowCompass,
  shouldShowRecentreControl,
  type CompassControlMapLike,
} from './map-controls.ts';

/**
 * Pins the Google-style controls policy (Session 6, step 4): the compass
 * exists only while the map is rotated, its needle counter-rotates the
 * bearing, resetting north honours the reduced-motion preference, and the
 * recentre control exists only while the follow camera is suspended.
 */

describe('normalizeBearingDeg', () => {
  it('folds every bearing into (-180, 180]', () => {
    assert.equal(normalizeBearingDeg(0), 0);
    assert.equal(normalizeBearingDeg(90), 90);
    assert.equal(normalizeBearingDeg(270), -90);
    assert.equal(normalizeBearingDeg(360), 0);
    assert.equal(normalizeBearingDeg(-350), 10);
    assert.equal(normalizeBearingDeg(180), 180);
    assert.equal(normalizeBearingDeg(-180), 180);
    assert.equal(normalizeBearingDeg(720 + 45), 45);
  });

  it('reads a non-finite bearing as north (no wild arrow)', () => {
    assert.equal(normalizeBearingDeg(Number.NaN), 0);
    assert.equal(normalizeBearingDeg(Number.POSITIVE_INFINITY), 0);
  });
});

describe('shouldShowCompass — appears ONLY when rotated', () => {
  it('hides at and near north-up', () => {
    assert.equal(shouldShowCompass(0), false);
    assert.equal(shouldShowCompass(0.3), false);
    assert.equal(shouldShowCompass(-0.4), false);
    assert.equal(shouldShowCompass(COMPASS_HIDDEN_BEARING_EPSILON_DEG), false, 'edge stays hidden');
    // One-third of a degree past a full turn is still "not meaningfully rotated".
    assert.equal(shouldShowCompass(360 - 0.3), false);
  });

  it('shows for genuine rotation, wrapped or not', () => {
    assert.equal(shouldShowCompass(12), true);
    assert.equal(shouldShowCompass(-COMPASS_HIDDEN_BEARING_EPSILON_DEG - 0.2), true);
    assert.equal(shouldShowCompass(270), true);
    assert.equal(shouldShowCompass(719), true);
  });
});

describe('the needle and the reset', () => {
  it('counter-rotates the camera bearing so the needle keeps pointing north', () => {
    assert.equal(compassNeedleRotationDeg(30), -30);
    assert.equal(compassNeedleRotationDeg(-90), 90);
    assert.equal(compassNeedleRotationDeg(270), 90);
    assert.equal(compassNeedleRotationDeg(0), 0);
  });

  it('animates the reset only when motion is welcome', () => {
    assert.equal(resetNorthDurationMs(false), COMPASS_RESET_NORTH_DURATION_MS);
    assert.ok(COMPASS_RESET_NORTH_DURATION_MS > 0);
    assert.equal(resetNorthDurationMs(true), 0, 'reduced motion: instant, never animated');
  });
});

describe('shouldShowRecentreControl — follows the EXISTING follow camera', () => {
  it('exists only while the user owns the camera', () => {
    assert.equal(shouldShowRecentreControl('exploring'), true);
    assert.equal(shouldShowRecentreControl('following'), false);
    assert.equal(shouldShowRecentreControl('anything-else'), false);
  });
});

describe('the compass control wiring (fake map, no engine)', () => {
  /** A minimal DOM good enough to exercise the control's imperative logic. */
  function fakeDom() {
    class ClassList {
      private set = new Set<string>();
      toggle(name: string, force: boolean) {
        if (force) this.set.add(name);
        else this.set.delete(name);
      }
      contains(name: string) {
        return this.set.has(name);
      }
    }
    const makeEl = () => {
      const el = {
        classList: new ClassList(),
        className: '',
        style: { transform: '' },
        type: '',
        listeners: {} as Record<string, () => void>,
        children: [] as unknown[],
        setAttribute(k: string, v: string) {
          (el as Record<string, unknown>)[`attr:${k}`] = v;
        },
        addEventListener(k: string, fn: () => void) {
          el.listeners[k] = fn;
        },
        append(...kids: unknown[]) {
          el.children.push(...kids);
        },
        remove() {
          /* detached anyway */
        },
      };
      return el;
    };
    const win = globalThis as { document?: unknown };
    const previousDocument = win.document;
    win.document = { createElement: makeEl };
    return () => {
      win.document = previousDocument;
    };
  }

  function fakeMap() {
    const state = {
      bearing: 0,
      listeners: [] as Array<() => void>,
      eased: [] as Array<{ bearing: number; duration: number }>,
      map: null as null | CompassControlMapLike,
    };
    state.map = {
      getBearing: () => state.bearing,
      easeTo(options) {
        state.eased.push(options);
        state.bearing = options.bearing;
        state.listeners.forEach((fn) => fn());
      },
      on(_type, fn) {
        state.listeners.push(fn);
      },
      off(_type, fn) {
        state.listeners = state.listeners.filter((candidate) => candidate !== fn);
      },
    };
    return state;
  }

  it('hides/shows on rotate events and resets bearing on tap — via easeTo, not a camera of its own', () => {
    const restore = fakeDom();
    try {
      const state = fakeMap();
      const control = createCompassControl({ reducedMotion: () => false });
      const container = control.onAdd(state.map!) as unknown as {
        classList: { contains(n: string): boolean };
        children: Array<{ listeners: Record<string, () => void>; children: Array<{ style: { transform: string } }> }>;
      };
      const needle = () => container.children[0].children[0];

      assert.ok(container.classList.contains('is-hidden'), 'north-up at mount: hidden');

      state.bearing = 25;
      state.listeners.forEach((fn) => fn());
      assert.ok(!container.classList.contains('is-hidden'), 'rotated: shown');
      assert.equal(needle().style.transform, 'rotate(-25deg)', 'needle counter-rotates');

      // The tap goes through the engine's easeTo back to 0.
      container.children[0].listeners.click();
      assert.deepEqual(state.eased, [{ bearing: 0, duration: COMPASS_RESET_NORTH_DURATION_MS }]);
      assert.ok(container.classList.contains('is-hidden'), 'back at north: hidden again');

      control.onRemove(state.map!);
      assert.equal(state.listeners.length, 0, 'listener cleaned up');
    } finally {
      restore();
    }
  });

  it('resets instantly under the reduced-motion preference', () => {
    const restore = fakeDom();
    try {
      const state = fakeMap();
      const control = createCompassControl({ reducedMotion: () => true });
      const container = control.onAdd(state.map!) as unknown as {
        children: Array<{ listeners: Record<string, () => void> }>;
      };
      state.bearing = 40;
      state.listeners.forEach((fn) => fn());
      container.children[0].listeners.click();
      assert.deepEqual(state.eased, [{ bearing: 0, duration: 0 }]);
      control.onRemove(state.map!);
    } finally {
      restore();
    }
  });
});
