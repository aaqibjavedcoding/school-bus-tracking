import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUS_MARKER_HEIGHT,
  BUS_MARKER_SVG,
  BUS_MARKER_WIDTH,
  busIconOptions,
  setBusIconHeading,
  type IconHost,
} from './bus-marker-icon.ts';

/** Minimal element/host doubles — no DOM, no `window`, no jsdom. */
function fakeHost(html: string): { host: IconHost; transforms: string[] } {
  const transforms: string[] = [];
  const rotor = { style: { transform: '' } };
  const element = {
    querySelector: (selector: string) => (selector === '.bus-marker-rotor' ? rotor : null),
  };
  void html;
  return {
    host: { getElement: () => element as unknown as HTMLElement },
    transforms,
  };
}

/**
 * Geometry and hygiene of the bus marker, checked without a browser.
 *
 * Three properties are load-bearing and easy to break silently by editing the
 * SVG: the graphic must point **north at heading 0°**, it must be anchored at
 * its **centre** so rotation happens about the GPS coordinate, and it must not
 * reference anything over the network.
 */

describe('bus marker geometry', () => {
  it('is anchored at its exact centre', () => {
    const icon = busIconOptions();
    assert.deepEqual(icon.iconSize, [BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT]);
    assert.deepEqual(icon.iconAnchor, [BUS_MARKER_WIDTH / 2, BUS_MARKER_HEIGHT / 2]);
  });

  it('anchors the popup above the marker, not through it', () => {
    const icon = busIconOptions();
    assert.deepEqual(icon.popupAnchor, [0, -BUS_MARKER_HEIGHT / 2]);
  });

  it('wraps the SVG in a rotor element so rotation never rebuilds the icon', () => {
    const icon = busIconOptions();
    assert.match(String(icon.html), /class="bus-marker-rotor"/);
    // The heading is applied to `.bus-marker-rotor` at frame rate; baking a
    // rotation into the icon html would rebuild the DOM every frame.
    assert.doesNotMatch(String(icon.html), /rotate\(/);
  });

  it('uses the app className so the default Leaflet white box does not appear', () => {
    assert.equal(busIconOptions().className, 'bus-marker');
  });
});

describe('bus marker graphic', () => {
  it('draws the nose at the top, so heading 0° is north', () => {
    // The windscreen is the front of the bus. In a 0..42 viewBox it must sit in
    // the top quarter; the darker rear must sit in the bottom quarter.
    const windscreen = BUS_MARKER_SVG.match(/<rect x="6" y="([\d.]+)" width="14" height="5"/);
    const rear = BUS_MARKER_SVG.match(/<rect x="6" y="([\d.]+)" width="14" height="3.5"/);
    assert.ok(windscreen, 'windscreen rect not found — the SVG shape changed');
    assert.ok(rear, 'rear rect not found — the SVG shape changed');
    assert.ok(Number(windscreen![1]) < BUS_MARKER_HEIGHT * 0.25, 'windscreen is not at the top');
    assert.ok(Number(rear![1]) > BUS_MARKER_HEIGHT * 0.75, 'rear is not at the bottom');
  });

  it('is symmetric about its vertical centre line, so rotating it keeps the centre fixed', () => {
    const body = BUS_MARKER_SVG.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/);
    assert.ok(body, 'body rect not found');
    const left = Number(body![1]);
    const width = Number(body![2]);
    assert.ok(
      Math.abs(left + width / 2 - BUS_MARKER_WIDTH / 2) < 0.01,
      `body centre ${left + width / 2} is not the marker centre ${BUS_MARKER_WIDTH / 2}`,
    );
  });

  it('uses the school-bus amber with a dark outline for contrast on any tile', () => {
    assert.match(BUS_MARKER_SVG, /fill="#f59e0b"/, 'body is not school-bus amber');
    assert.match(BUS_MARKER_SVG, /stroke="#0f172a"/, 'the near-black outline is missing');
  });

  it('references nothing over the network', () => {
    // The `xmlns` URI is a mandatory namespace identifier, not a fetch — no
    // renderer ever retrieves it. Strip it, then assert the rest is local.
    const withoutNamespace = BUS_MARKER_SVG.replace(/xmlns="[^"]*"/, '');
    assert.doesNotMatch(withoutNamespace, /https?:\/\//, 'the SVG must not fetch anything');
    assert.doesNotMatch(withoutNamespace, /<image/i, 'no external image elements');
    assert.doesNotMatch(withoutNamespace, /url\(/i, 'no external references');
    assert.doesNotMatch(withoutNamespace, /xlink:href/i, 'no external links');
    // Inline so no CSP `img-src` entry is needed.
    assert.match(BUS_MARKER_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it('keeps a stable size rather than a fluid one', () => {
    assert.match(BUS_MARKER_SVG, new RegExp(`width="${BUS_MARKER_WIDTH}"`));
    assert.match(BUS_MARKER_SVG, new RegExp(`height="${BUS_MARKER_HEIGHT}"`));
  });
});

describe('setBusIconHeading', () => {
  it('rotates the rotor element in place rather than rebuilding the icon', () => {
    const { host } = fakeHost('');
    const rotor = host.getElement()!.querySelector<HTMLElement>('.bus-marker-rotor')!;
    setBusIconHeading(host, 87);
    assert.equal(rotor.style.transform, 'rotate(87deg)');
    setBusIconHeading(host, 0);
    assert.equal(rotor.style.transform, 'rotate(0deg)');
  });

  it('renders heading 0 as north, not as "unrotated by accident"', () => {
    const { host } = fakeHost('');
    setBusIconHeading(host, null);
    const rotor = host.getElement()!.querySelector<HTMLElement>('.bus-marker-rotor')!;
    assert.equal(rotor.style.transform, 'rotate(0deg)');
  });

  it('is a no-op rather than a crash when the element is not attached yet', () => {
    assert.doesNotThrow(() => setBusIconHeading(null, 45));
    assert.doesNotThrow(() => setBusIconHeading({ getElement: () => null }, 45));
  });
});
