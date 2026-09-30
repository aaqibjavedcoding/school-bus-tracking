import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUS_MARKER_HEIGHT,
  BUS_MARKER_SVG,
  BUS_MARKER_WIDTH,
  MAP_ASSET_SPRITE_ID,
  applyBusMarkerState,
  busIconOptions,
  mapAssetSpriteMarkup,
  setBusIconHeading,
  type IconHost,
} from './bus-marker-icon.ts';
import { MAP_ASSET_IDS } from '@school-bus-tracking/map-assets';

/** Minimal element/host doubles — no DOM, no `window`, no jsdom. */
function fakeHost(): { host: IconHost; rotor: { style: { transform: string } } } {
  const rotor = { style: { transform: '' } };
  const element = {
    querySelector: (selector: string) => (selector === '.bus-marker-rotor' ? rotor : null),
  };
  return {
    host: { getElement: () => element as unknown as HTMLElement },
    rotor,
  };
}

/**
 * Geometry and hygiene of the bus marker, checked without a browser.
 *
 * The artwork now lives in `@school-bus-tracking/map-assets` (one source for web
 * and mobile), so these tests protect the WEB WIRING and the load-bearing
 * geometry: centre anchor (rotation about the GPS coordinate), nose-up at
 * heading 0°, no network reference, and the `<defs>`/`<use>` inlining.
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

  it('uses the app className so the default map white box does not appear', () => {
    assert.equal(busIconOptions().className, 'bus-marker');
  });
});

describe('the shared sprite is inlined once and referenced, never parsed per marker', () => {
  it('publishes the bus body and shadow groups under stable ids', () => {
    const sprite = mapAssetSpriteMarkup();
    assert.match(sprite, new RegExp(`id="${MAP_ASSET_SPRITE_ID}"`), 'the sprite is id-guarded');
    assert.match(sprite, new RegExp(`id="${MAP_ASSET_IDS.busBody}"`), 'exposes the bus body');
    assert.match(sprite, new RegExp(`id="${MAP_ASSET_IDS.busShadow}"`), 'exposes the shadow');
    // The sprite is hidden and off-layout so it never affects the page.
    assert.match(sprite, /aria-hidden="true"/);
    assert.match(sprite, /width="0"/);
  });
});

describe('bus marker graphic (shared source)', () => {
  it('draws the nose at the top, so heading 0° is north', () => {
    // The windscreen (glass) and headlights are at the nose; the rear window is
    // at the tail. In a 0..210 viewBox the headlights sit in the top quarter and
    // the rear window in the bottom quarter.
    const headlight = BUS_MARKER_SVG.match(/<circle cx="33" cy="([\d.]+)"/);
    const rear = BUS_MARKER_SVG.match(/<rect x="38" y="([\d.]+)" width="54" height="16"/);
    assert.ok(headlight, 'headlight not found — the SVG shape changed');
    assert.ok(rear, 'rear window not found — the SVG shape changed');
    assert.ok(Number(headlight![1]) < 210 * 0.25, 'headlights are not at the nose (top)');
    assert.ok(Number(rear![1]) > 210 * 0.6, 'rear window is not at the tail (bottom)');
  });

  it('uses a school-bus amber gradient body with a dark outline', () => {
    assert.match(BUS_MARKER_SVG, /#f59e0b/, 'the amber body colour is missing');
    assert.match(BUS_MARKER_SVG, /stroke="#0f172a"/, 'the near-black outline is missing');
    assert.match(BUS_MARKER_SVG, /linearGradient/, 'the body gradient is missing');
  });

  it('carries a glass windscreen with a specular highlight', () => {
    assert.match(
      BUS_MARKER_SVG,
      new RegExp(`url\\(#${MAP_ASSET_IDS.busGlass}\\)`),
      'no glass fill',
    );
    assert.match(BUS_MARKER_SVG, /fill="#ffffff" opacity="0.5"/, 'no specular highlight');
  });

  it('references nothing over the network', () => {
    // Local `url(#id)` paint-servers are fine — those are not fetches. What must
    // never appear is an http(s) URL (other than the mandatory xmlns), an
    // external <image>, or an xlink to somewhere off-document.
    const withoutNamespace = BUS_MARKER_SVG.replace(/xmlns="[^"]*"/, '');
    assert.doesNotMatch(withoutNamespace, /https?:\/\//, 'the SVG must not fetch anything');
    assert.doesNotMatch(withoutNamespace, /<image/i, 'no external image elements');
    assert.doesNotMatch(withoutNamespace, /xlink:href/i, 'no external links');
    assert.match(BUS_MARKER_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  it('keeps a stable box size rather than a fluid one', () => {
    assert.match(BUS_MARKER_SVG, new RegExp(`width="${BUS_MARKER_WIDTH}"`));
    assert.match(BUS_MARKER_SVG, new RegExp(`height="${BUS_MARKER_HEIGHT}"`));
  });
});

describe('setBusIconHeading', () => {
  it('rotates the rotor element in place rather than rebuilding the icon', () => {
    const { host, rotor } = fakeHost();
    setBusIconHeading(host, 87);
    assert.equal(rotor.style.transform, 'rotate(87deg)');
    setBusIconHeading(host, 0);
    assert.equal(rotor.style.transform, 'rotate(0deg)');
  });

  it('renders heading 0 as north, not as "unrotated by accident"', () => {
    const { host, rotor } = fakeHost();
    setBusIconHeading(host, null);
    assert.equal(rotor.style.transform, 'rotate(0deg)');
  });

  it('is a no-op rather than a crash when the element is not attached yet', () => {
    assert.doesNotThrow(() => setBusIconHeading(null, 45));
    assert.doesNotThrow(() => setBusIconHeading({ getElement: () => null }, 45));
  });
});

describe('applyBusMarkerState', () => {
  it('writes the tone / pulse / cone data attributes the stylesheet keys off', () => {
    const el = { dataset: {} as DOMStringMap };
    applyBusMarkerState(el, { tone: 'live', pulse: true, cone: true });
    assert.equal(el.dataset.tone, 'live');
    assert.equal(el.dataset.pulse, 'on');
    assert.equal(el.dataset.cone, 'on');

    applyBusMarkerState(el, { tone: 'stale', pulse: false, cone: false });
    assert.equal(el.dataset.tone, 'stale');
    assert.equal(el.dataset.pulse, 'off');
    assert.equal(el.dataset.cone, 'off');
  });

  it('is a no-op rather than a crash without an element', () => {
    assert.doesNotThrow(() =>
      applyBusMarkerState(null, { tone: 'live', pulse: false, cone: false }),
    );
  });
});
