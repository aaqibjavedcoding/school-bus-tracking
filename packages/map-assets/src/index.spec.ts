import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUS_BODY_SVG,
  BUS_MARKER_BOX,
  BUS_MARKER_HEIGHT,
  BUS_MARKER_ROTATION_BOX,
  BUS_MARKER_SVG,
  BUS_MARKER_WIDTH,
  BUS_SHADOW_SVG,
  HEADING_GATE_KMH,
  MAP_ASSET_IDS,
  STOP_MARKER_SVG,
  resolveBusMarkerVisualState,
} from './index.ts';

describe('shared marker geometry', () => {
  it('exposes the footprint box and its rotation square', () => {
    assert.equal(BUS_MARKER_WIDTH, 26);
    assert.equal(BUS_MARKER_HEIGHT, 42);
    assert.deepEqual(BUS_MARKER_BOX, {
      width: 26,
      height: 42,
      rotationBox: Math.ceil(Math.hypot(26, 42)),
    });
    assert.equal(BUS_MARKER_ROTATION_BOX, Math.ceil(Math.hypot(26, 42)));
  });
});

describe('one bus artwork, split into rotating body + static shadow', () => {
  it('the full SVG contains BOTH the shadow group and the body group', () => {
    assert.match(BUS_MARKER_SVG, new RegExp(`id="${MAP_ASSET_IDS.busShadow}"`));
    assert.match(BUS_MARKER_SVG, new RegExp(`id="${MAP_ASSET_IDS.busBody}"`));
  });

  it('the body-only SVG (what mobile rasterises) has NO shadow, so the PNG never spins a shadow', () => {
    assert.match(BUS_BODY_SVG, new RegExp(`id="${MAP_ASSET_IDS.busBody}"`));
    assert.doesNotMatch(BUS_BODY_SVG, new RegExp(`id="${MAP_ASSET_IDS.busShadow}"`));
  });

  it('the shadow-only SVG is just the shadow', () => {
    assert.match(BUS_SHADOW_SVG, new RegExp(`id="${MAP_ASSET_IDS.busShadow}"`));
    assert.doesNotMatch(BUS_SHADOW_SVG, new RegExp(`id="${MAP_ASSET_IDS.busBody}"`));
  });

  it('is nose-up: headlights at the top, rear window at the bottom', () => {
    const headlight = BUS_BODY_SVG.match(/<circle cx="33" cy="([\d.]+)"/);
    const rear = BUS_BODY_SVG.match(/<rect x="38" y="([\d.]+)" width="54" height="16"/);
    assert.ok(headlight && rear);
    assert.ok(Number(headlight![1]) < 210 * 0.25);
    assert.ok(Number(rear![1]) > 210 * 0.6);
  });
});

describe('the stop marker is a different species', () => {
  it('is a slate pin, not the amber bus box', () => {
    assert.match(STOP_MARKER_SVG, new RegExp(`id="${MAP_ASSET_IDS.stopPin}"`));
    // A teardrop path, not a rounded rectangle, and no amber.
    assert.match(STOP_MARKER_SVG, /<path d="M30 6/);
    assert.doesNotMatch(STOP_MARKER_SVG, /#f59e0b/);
  });
});

describe('resolveBusMarkerVisualState', () => {
  const base = { live: true, reducedMotion: false, speedKmh: 20, hasHeading: true };

  it('live + moving → full colour, pulse, cone', () => {
    assert.deepEqual(resolveBusMarkerVisualState(base), {
      tone: 'live',
      pulse: true,
      cone: true,
    });
  });

  it('live + stopped (below the 3 km/h gate) → full colour, pulse, no cone', () => {
    assert.deepEqual(resolveBusMarkerVisualState({ ...base, speedKmh: 1 }), {
      tone: 'live',
      pulse: true,
      cone: false,
    });
    // Exactly at the gate counts as moving.
    assert.equal(resolveBusMarkerVisualState({ ...base, speedKmh: HEADING_GATE_KMH }).cone, true);
  });

  it('no heading → no cone even at speed', () => {
    assert.equal(resolveBusMarkerVisualState({ ...base, hasHeading: false }).cone, false);
  });

  it('stale → desaturated, no pulse, no cone', () => {
    assert.deepEqual(resolveBusMarkerVisualState({ ...base, live: false }), {
      tone: 'stale',
      pulse: false,
      cone: false,
    });
  });

  it('reduced motion → no pulse, but the (static) cone survives', () => {
    const state = resolveBusMarkerVisualState({ ...base, reducedMotion: true });
    assert.equal(state.pulse, false);
    assert.equal(state.cone, true);
  });

  it('null / non-finite speed is treated as stopped', () => {
    assert.equal(resolveBusMarkerVisualState({ ...base, speedKmh: null }).cone, false);
    assert.equal(resolveBusMarkerVisualState({ ...base, speedKmh: NaN }).cone, false);
  });
});
