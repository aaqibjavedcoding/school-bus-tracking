import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BUS_MARKER_BOX, STOP_MARKER_SVG } from '@school-bus-tracking/map-assets';

import {
  BUS_MARKER_HEIGHT,
  BUS_MARKER_ROTATION_BOX,
  BUS_MARKER_SVG,
  BUS_MARKER_WIDTH,
  busIconOptions,
  setBusIconHeading,
  type IconHost,
} from './bus-marker-icon.ts';

/** Minimal element/host doubles — no DOM, no `window`, no jsdom. */
function fakeHost(): IconHost {
  const rotor = { style: { transform: '' } };
  const element = {
    querySelector: (selector: string) => (selector === '.bus-marker-rotor' ? rotor : null),
  };
  return { getElement: () => element };
}

describe('shared bus marker geometry', () => {
  it('preserves the 26 × 42 centre anchor and diagonal rotation box', () => {
    const icon = busIconOptions();
    assert.equal(BUS_MARKER_WIDTH, BUS_MARKER_BOX.width);
    assert.equal(BUS_MARKER_HEIGHT, BUS_MARKER_BOX.height);
    assert.equal(BUS_MARKER_ROTATION_BOX, BUS_MARKER_BOX.rotationBox);
    assert.deepEqual(icon.iconSize, [BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT]);
    assert.deepEqual(icon.iconAnchor, [BUS_MARKER_WIDTH / 2, BUS_MARKER_HEIGHT / 2]);
    assert.deepEqual(icon.popupAnchor, [0, -BUS_MARKER_HEIGHT / 2]);
  });

  it('uses a use-based marker shell rather than embedding a second bus', () => {
    const icon = busIconOptions();
    assert.match(icon.html, /class="bus-marker-rotor"/);
    assert.match(icon.html, /<use href="#sbt-bus-marker-art"/);
    assert.doesNotMatch(icon.html, /<path|<rect|<linearGradient/);
    assert.equal(icon.className, 'bus-marker');
  });
});

describe('shared bus marker artwork', () => {
  it('is a fixed-size top-down nose-up bus: halo, amber body, windshield band, side windows, hatches, bumper', () => {
    assert.match(BUS_MARKER_SVG, new RegExp(`width="${BUS_MARKER_WIDTH}"`));
    assert.match(BUS_MARKER_SVG, new RegExp(`height="${BUS_MARKER_HEIGHT}"`));
    assert.match(BUS_MARKER_SVG, /White outline halo/);
    assert.match(BUS_MARKER_SVG, /fill="#F6B500"/, 'school-bus amber body');
    assert.match(BUS_MARKER_SVG, /fill="#FFC93C"/, 'lighter flat roof panel');
    assert.match(BUS_MARKER_SVG, /Front windshield band/, 'the heading cue at the nose');
    assert.match(BUS_MARKER_SVG, /Side window rows/);
    assert.match(BUS_MARKER_SVG, /Roof hatches/);
    assert.match(BUS_MARKER_SVG, /Rear bumper band/);
    // Dark slate glazing must read against the amber at 26 px.
    assert.match(BUS_MARKER_SVG, /fill="#16283C"/);
  });

  it('stays legible at marker size: flat fills, no text, no baked wheels', () => {
    assert.doesNotMatch(
      BUS_MARKER_SVG,
      /<linearGradient|<radialGradient/,
      'gradients go muddy at 26 px',
    );
    assert.doesNotMatch(BUS_MARKER_SVG, /<text/i, 'labels are unreadable at marker size');
    assert.doesNotMatch(BUS_MARKER_SVG, /wheel/i, 'wheels are invisible in a top-down roof view');
  });

  it('keeps its soft ground shadow outside the rotating group', () => {
    const shadow = BUS_MARKER_SVG.indexOf('href="#sbt-bus-marker-shadow"');
    const rotor = BUS_MARKER_SVG.indexOf('id="sbt-bus-marker-rotating-group"');
    assert.ok(shadow !== -1 && rotor !== -1 && shadow < rotor);
  });

  it('references nothing over the network', () => {
    const withoutNamespace = BUS_MARKER_SVG.replace(/xmlns="[^"]*"/, '');
    assert.doesNotMatch(withoutNamespace, /https?:\/\//, 'the SVG must not fetch anything');
    assert.doesNotMatch(withoutNamespace, /<image/i, 'no external image elements');
    assert.doesNotMatch(withoutNamespace, /xlink:href/i, 'no external links');
  });

  it('also exports a clearly non-vehicle lifted stop pin with a contrast ring', () => {
    assert.match(STOP_MARKER_SVG, /sbt-stop-lift/);
    assert.match(STOP_MARKER_SVG, /stroke="#fff"/);
    assert.match(STOP_MARKER_SVG, /<circle cx="12" cy="11"/);
  });
});

describe('web marker creation hygiene', () => {
  it('mounts shared defs once and never innerHTML-parses an SVG per marker', () => {
    const source = readFileSync(`${process.cwd()}/src/features/map/MapViewInner.tsx`, 'utf8');
    assert.match(source, /BUS_MARKER_DEFS_SVG/);
    assert.match(source, /<defs dangerouslySetInnerHTML/);
    assert.match(source, /document\.createElementNS\(SVG_NS/);
    assert.doesNotMatch(source, /container\.innerHTML\s*=/);
  });
});

describe('setBusIconHeading', () => {
  it('rotates the existing rotor in place rather than rebuilding a marker', () => {
    const host = fakeHost();
    const rotor = host.getElement()!.querySelector('.bus-marker-rotor')!;
    setBusIconHeading(host, 87);
    assert.equal(rotor.style.transform, 'rotate(87deg)');
    setBusIconHeading(host, 0);
    assert.equal(rotor.style.transform, 'rotate(0deg)');
  });

  it('makes heading 0 north and is safe before attachment', () => {
    const host = fakeHost();
    setBusIconHeading(host, null);
    assert.equal(
      host.getElement()!.querySelector('.bus-marker-rotor')!.style.transform,
      'rotate(0deg)',
    );
    assert.doesNotThrow(() => setBusIconHeading(null, 45));
    assert.doesNotThrow(() => setBusIconHeading({ getElement: () => null }, 45));
  });
});
