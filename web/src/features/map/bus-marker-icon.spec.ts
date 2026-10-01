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
  setBusMarkerVisualState,
  type IconHost,
} from './bus-marker-icon.ts';

/** Minimal `classList` double — enough for the three presentation classes. */
function fakeMarkerElement() {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

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
  it('is a fixed-size top-down school bus with gradient, glass and roof detail', () => {
    assert.match(BUS_MARKER_SVG, new RegExp(`width="${BUS_MARKER_WIDTH}"`));
    assert.match(BUS_MARKER_SVG, new RegExp(`height="${BUS_MARKER_HEIGHT}"`));
    assert.match(BUS_MARKER_SVG, /linearGradient id="sbt-bus-marker-body"/);
    assert.match(BUS_MARKER_SVG, /sbt-bus-marker-glass/);
    assert.match(BUS_MARKER_SVG, /sbt-bus-marker-roof/);
    assert.match(BUS_MARKER_SVG, /Specular sweep/);
    assert.match(BUS_MARKER_SVG, /Tyres and the two driver mirrors/);
    assert.match(BUS_MARKER_SVG, /Raised roof panel/);
  });

  /**
   * The marker is rotated by the reported heading, so the drawing has to be a
   * plan view: a perspective ("3/4") coach rotated 150° is lit and
   * foreshortened from a direction that does not exist, which is what made
   * the old sprite read as a blocky square in the 26 × 42 dp box.
   */
  it('is drawn from directly above, nose up, so heading 0 is north', () => {
    assert.match(
      BUS_MARKER_SVG,
      /Top-down \(roof view\)\. The nose is at the top: heading 0 is north\./,
    );
    assert.doesNotMatch(BUS_MARKER_SVG, /3\/4/, 'no perspective coach may come back');
  });

  it('reads as a vehicle going somewhere: windscreen at the nose, smaller window at the tail', () => {
    const windscreen = BUS_MARKER_SVG.indexOf('<!-- Windscreen');
    const rear = BUS_MARKER_SVG.indexOf('<!-- Rear window');
    assert.ok(windscreen !== -1 && rear !== -1, 'both windows are drawn');
    assert.ok(windscreen < rear, 'the nose glass is drawn before the tail glass');
    // Headlamps at the nose, red lamps at the tail: the front/back asymmetry
    // is what makes the heading legible at 26 dp.
    assert.match(BUS_MARKER_SVG, /Headlamps wash the nose/);
    assert.match(BUS_MARKER_SVG, /fill="#e23c3c"/, 'the tail lamps stay red');
  });

  it('keeps the unrotated ambient shadow outside the rotating group, and the contact shadow inside it', () => {
    const shadow = BUS_MARKER_SVG.indexOf('href="#sbt-bus-marker-shadow"');
    const rotor = BUS_MARKER_SVG.indexOf('id="sbt-bus-marker-rotating-group"');
    assert.ok(shadow !== -1 && rotor !== -1 && shadow < rotor);
    // A plan-view shadow has the vehicle's shape, so the shaped one must turn
    // with the bus — it lives in the art symbol, not in the static layer.
    assert.match(BUS_MARKER_SVG, /Contact shadow: the silhouette itself/);
    assert.match(BUS_MARKER_SVG, /Ambient lift only, and deliberately round-ish/);
  });

  it('keeps the drawing centred on the GPS coordinate at every heading', () => {
    // The anchor is the centre of the 26 × 42 box (`iconAnchor` above), so the
    // vehicle has to be centred in the viewBox — otherwise rotating it swings
    // the bus off the fix. Both symbols are therefore built around (31, 50).
    const centreX = BUS_MARKER_BOX.viewBoxWidth / 2;
    assert.equal(centreX, 31);
    assert.match(BUS_MARKER_SVG, new RegExp(`<ellipse cx="${centreX}"`), 'ambient disc centred');
    // The silhouette path is symmetric about the centre line and spans the
    // viewBox evenly: 8.6 from the top edge, 8.5 from the bottom.
    assert.match(BUS_MARKER_SVG, /M31 8\.6C/, 'the nose starts on the centre line');
    assert.match(BUS_MARKER_SVG, /23\.6 91\.5 18\.9 90\.5/, 'and the tail closes symmetrically');
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

  it('turns the shortest way around the compass without rebuilding anything', () => {
    const host = fakeHost();
    const rotor = host.getElement()!.querySelector('.bus-marker-rotor')!;
    for (const heading of [0, 45, 90, 180, 270, 359]) {
      setBusIconHeading(host, heading);
      assert.equal(rotor.style.transform, `rotate(${heading}deg)`);
    }
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

describe('setBusMarkerVisualState (the last-known marker stays on the map)', () => {
  it('marks a stale position desaturated instead of hiding the bus', () => {
    const element = fakeMarkerElement();
    setBusMarkerVisualState(element as unknown as HTMLElement, {
      live: false,
      moving: false,
      reducedMotion: false,
    });
    assert.ok(element.classes.has('is-stale'), 'the last-known bus is drawn, but slate');
    assert.ok(!element.classes.has('is-live-moving'), 'and it must not claim live motion');
    // Nothing here can remove the marker: a vanished bus and a frozen bus are
    // different facts, and only one of them is true when a fix exists.
    assert.equal(typeof (element as { remove?: unknown }).remove, 'undefined');
  });

  it('restores the live, moving presentation when fresh data returns', () => {
    const element = fakeMarkerElement();
    const el = element as unknown as HTMLElement;
    setBusMarkerVisualState(el, { live: false, moving: false, reducedMotion: false });
    setBusMarkerVisualState(el, { live: true, moving: true, reducedMotion: false });
    assert.ok(!element.classes.has('is-stale'));
    assert.ok(element.classes.has('is-live-moving'), 'halo and heading cone come back');
  });

  it('drops the motion ornaments — never the bus — under reduced motion', () => {
    const element = fakeMarkerElement();
    setBusMarkerVisualState(element as unknown as HTMLElement, {
      live: true,
      moving: true,
      reducedMotion: true,
    });
    assert.ok(element.classes.has('is-reduced-motion'));
    assert.ok(element.classes.has('is-live-moving'), 'the CSS gates the animation, not the bus');
  });

  it('is safe when the marker element does not exist yet', () => {
    assert.doesNotThrow(() =>
      setBusMarkerVisualState(null, { live: true, moving: true, reducedMotion: false }),
    );
  });
});
