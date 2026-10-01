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
  it('is a fixed-size TOP-DOWN nose-up coach with roof, glass and wheel detail', () => {
    assert.match(BUS_MARKER_SVG, new RegExp(`width="${BUS_MARKER_WIDTH}"`));
    assert.match(BUS_MARKER_SVG, new RegExp(`height="${BUS_MARKER_HEIGHT}"`));
    assert.match(BUS_MARKER_SVG, /linearGradient id="sbt-bus-marker-body"/);
    assert.match(BUS_MARKER_SVG, /sbt-bus-marker-roof/);
    assert.match(BUS_MARKER_SVG, /sbt-bus-marker-glass/);
    assert.match(BUS_MARKER_SVG, /specular/);
    // The artwork is a roof view, not a lifted 3/4 block: the navigation-app
    // reading only works if the drawing has no perspective at all.
    assert.match(BUS_MARKER_SVG, /TOP-DOWN \(roof view\) school bus/);
    assert.doesNotMatch(BUS_MARKER_SVG, /3\/4/, 'no perspective drawing survives');
    assert.match(BUS_MARKER_SVG, /Wheels first: dark rounded stubs/);
    assert.match(BUS_MARKER_SVG, /Roof cap \/ roof line/);
    assert.match(BUS_MARKER_SVG, /Front windscreen/);
    assert.match(BUS_MARKER_SVG, /Rear window band/);
  });

  it('keeps the artwork symmetric about the marker centre line, so rotation reads true', () => {
    // Heading rotation happens about the exact centre of the 26 x 42 box
    // (viewBox x = 31). A top-down vehicle that is not mirror-symmetric about
    // that line would appear to crab sideways as it turns.
    const centre = 31;
    const pairs: [number, number][] = [
      [6.4, 48.4], // wheel rows
      [5.6, 50], // wing mirrors
      [17.5, 39.9], // side glazing rails
    ];
    for (const [left, right] of pairs) {
      assert.match(BUS_MARKER_SVG, new RegExp(`x="${left}"`));
      assert.match(BUS_MARKER_SVG, new RegExp(`x="${right}"`));
      // Mirrored boxes: left edge and right edge are equidistant from centre.
      const width = left === 17.5 ? 4.6 : left === 5.6 ? 6.4 : 7.2;
      assert.ok(Math.abs(centre - left - (right + width - centre)) < 0.001);
    }
    // The lamp pairs straddle the centre line too.
    assert.match(BUS_MARKER_SVG, /cx="22.4" cy="12.6"/);
    assert.match(BUS_MARKER_SVG, /cx="39.6" cy="12.6"/);
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
