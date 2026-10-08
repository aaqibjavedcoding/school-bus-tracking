import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KIDBUS_NIGHT_STYLE_URL,
  defaultStyleUrlForScheme,
  resolveThemedMapStyleUrl,
} from './style-variant.ts';
import { DEFAULT_MAP_STYLE_URL, MAP_STYLE_ENV_VARIABLE } from './map-style.ts';
import { KIDBUS_DAY_STYLE, KIDBUS_NIGHT_STYLE, nightPaintFor } from '@school-bus-tracking/map-assets';

/**
 * Night-style selection + the kidbus-night asset (Session 6, step 3).
 *
 * The selection is a pure function of the app's existing theme signal (OS
 * prefers-color-scheme); the override keeps absolute precedence; and the
 * shipped night JSON is the day style recoloured, nothing more — same free
 * sources, same sprite, same glyphs, no key anywhere.
 */

const env = (value: string | undefined) => ({ [MAP_STYLE_ENV_VARIABLE]: value });

let warnings: string[];
let realWarn: typeof console.warn;

beforeEach(() => {
  warnings = [];
  realWarn = console.warn;
  console.warn = (message: string) => {
    warnings.push(message);
  };
});

afterEach(() => {
  console.warn = realWarn;
});

describe('the theme signal picks between the two shipped styles', () => {
  it('light stays on the Session 5 default, dark flips to kidbus-night', () => {
    assert.equal(defaultStyleUrlForScheme('light'), DEFAULT_MAP_STYLE_URL);
    assert.equal(defaultStyleUrlForScheme('light'), '/map-styles/kidbus-day.json');
    assert.equal(defaultStyleUrlForScheme('dark'), '/map-styles/kidbus-night.json');
  });

  it('an unset/blank override defers to the theme', () => {
    assert.equal(resolveThemedMapStyleUrl({}, 'dark'), KIDBUS_NIGHT_STYLE_URL);
    assert.equal(resolveThemedMapStyleUrl(env(''), 'dark'), KIDBUS_NIGHT_STYLE_URL);
    assert.equal(resolveThemedMapStyleUrl(env('   '), 'light'), DEFAULT_MAP_STYLE_URL);
    assert.equal(warnings.length, 0);
  });

  it('a valid override always wins — night is never forced on a self-hoster', () => {
    const selfHosted = 'https://tiles.schoolbustracking.example/styles/bright';
    assert.equal(resolveThemedMapStyleUrl(env(selfHosted), 'dark'), selfHosted);
    assert.equal(resolveThemedMapStyleUrl(env(selfHosted), 'light'), selfHosted);
    assert.equal(warnings.length, 0);
  });

  it('an invalid override keeps the Session 5 fallback exactly (warn once, day default)', () => {
    assert.equal(resolveThemedMapStyleUrl(env('http://tiles.example.org/s'), 'dark'), DEFAULT_MAP_STYLE_URL);
    assert.equal(warnings.length, 1, 'the existing https-only warning survived the theme layer');
  });

  it('selection is pure: no hidden state between calls', () => {
    resolveThemedMapStyleUrl(env('https://a.example/s'), 'dark');
    assert.equal(resolveThemedMapStyleUrl({}, 'dark'), KIDBUS_NIGHT_STYLE_URL);
    assert.equal(resolveThemedMapStyleUrl({}, 'light'), DEFAULT_MAP_STYLE_URL);
  });
});

describe('the kidbus-night style asset', () => {
  interface StyleLike {
    name: string;
    sources: Record<string, { url?: string }>;
    glyphs: string;
    sprite: string;
    layers: Array<{ id: string; type: string; layout?: unknown; paint?: Record<string, unknown>; 'source-layer'?: string; source?: string }>;
  }
  const day = KIDBUS_DAY_STYLE as unknown as StyleLike;
  const night = KIDBUS_NIGHT_STYLE as unknown as StyleLike;

  it('is the day style recoloured: same sources, sprite, glyphs and layer structure', () => {
    assert.equal(night.name, 'kidbus-night');
    assert.deepEqual(night.sources, day.sources, 'same one free tile source — nothing added');
    assert.equal(night.sprite, day.sprite);
    assert.equal(night.glyphs, day.glyphs);
    assert.deepEqual(
      night.layers.map((layer) => layer.id),
      day.layers.map((layer) => layer.id),
      'same layers in the same order',
    );
    assert.deepEqual(
      night.layers.map((layer) => layer.type),
      day.layers.map((layer) => layer.type),
    );
    for (const [index, layer] of night.layers.entries()) {
      assert.deepEqual(layer.layout, day.layers[index].layout, `${layer.id}: layout unchanged`);
    }
  });

  it('only paint changed — and to the pinned night palette', () => {
    const paintOf = (style: StyleLike, id: string) => style.layers.find((l) => l.id === id)?.paint ?? {};
    // Land, water, roads, casings, labels — the palette from the session brief,
    // re-pinned for the Session-7 cartography. Two renames are deliberate:
    // `place` is no longer one layer (the area names are class-wise now, and the
    // night palette is asserted against `place-suburb`, the layer this pass
    // exists to make visible), and the single `road-fills`/`road-casings` pair
    // became one pass per width group — the values are pinned on the `secondary`
    // group, whose class match covers the mid/high end of both.
    assert.equal(paintOf(night, 'background')['background-color'], '#202124');
    assert.equal(paintOf(night, 'water')['fill-color'], '#17263c');
    assert.equal(paintOf(night, 'waterway')['line-color'], '#17263c');
    assert.equal((paintOf(night, 'road-casing-secondary')['line-color'] as unknown[]).at(-1), '#1a1b1d');
    assert.equal((paintOf(night, 'road-fill-secondary')['line-color'] as unknown[]).at(-1), '#3c4043');
    // The road hierarchy survives the recolouring: arterials stay amber.
    // ['match', ['get','class'], <classes>, <colour>, …]
    assert.deepEqual((paintOf(night, 'road-fill-major')['line-color'] as unknown[]).slice(2, 4), [
      ['motorway', 'motorway_link', 'trunk', 'trunk_link'],
      '#a8862f',
    ]);
    assert.equal(paintOf(night, 'transportation_name')['text-color'], '#9aa0a6');
    assert.equal(paintOf(night, 'place-suburb')['text-color'], '#9aa0a6');
    assert.equal(paintOf(night, 'poi')['text-color'], '#9aa0a6');
    // day paints really were replaced on every layer that has one
    for (const layer of night.layers) {
      if (day.layers.find((d) => d.id === layer.id)?.paint) {
        assert.notDeepEqual(layer.paint, day.layers.find((d) => d.id === layer.id)?.paint, `${layer.id} recoloured`);
      }
    }
  });

  it('changes colour, never geometry: every road keeps the day style\'s own width', () => {
    const paintOf = (style: StyleLike, id: string) => style.layers.find((l) => l.id === id)?.paint ?? {};
    const roadIds = day.layers
      .map((layer) => layer.id)
      .filter((id) => id.startsWith('road-'));
    assert.ok(roadIds.length >= 12, `expected the road passes, found ${roadIds.length}`);
    // Night is a recolour of the day style, and `nightPaintFor` copies every
    // paint key it does not override — so the widths (fill and casing, all
    // three brunnel passes) are the *same expression instances*. If night ever
    // starts carrying its own ladder, a road would change width at dusk.
    for (const id of roadIds) {
      assert.deepEqual(paintOf(night, id)['line-width'], paintOf(day, id)['line-width'], `${id} width`);
      assert.notDeepEqual(paintOf(night, id)['line-color'], paintOf(day, id)['line-color'], `${id} recoloured`);
    }
    // And the casing really is its fill + a constant, stop for stop, so an
    // edited fill table can never leave a road with a hairline edge.
    for (const [fillId, casingId, extra] of [
      ['road-fill-major', 'road-casing-major', 1.4],
      ['road-fill-secondary', 'road-casing-secondary', 1.2],
      ['road-fill-minor', 'road-casing-minor', 1.2],
    ] as const) {
      // ['interpolate', ['linear'], ['zoom'], z0, w0, z1, w1, …]
      const widths = (id: string) =>
        (paintOf(day, id)['line-width'] as unknown[]).slice(4).filter((_, index) => index % 2 === 0).map(Number);
      assert.equal((paintOf(day, fillId)['line-width'] as unknown[])[0], 'interpolate');
      assert.deepEqual(
        widths(casingId),
        widths(fillId).map((width) => width + extra),
        `${casingId} must be ${fillId} + ${extra}px at every stop`,
      );
    }
  });

  it('recolours every place class, not just the big names', () => {
    const paintOf = (style: StyleLike, id: string) => style.layers.find((l) => l.id === id)?.paint ?? {};
    // The complaint being fixed is that a colony/suburb name never appeared.
    // A place layer that kept its daytime halo on a black map would be just as
    // invisible, so every class the day style ships has a night paint.
    for (const id of [
      'place-city',
      'place-town',
      'place-village',
      'place-suburb',
      'place-quarter',
      'place-hamlet',
      'place-neighbourhood',
      'place-state',
    ]) {
      assert.ok(day.layers.some((l) => l.id === id), `the day style must ship ${id}`);
      assert.equal(paintOf(night, id)['text-halo-color'], '#202124', `${id} night halo`);
      assert.notDeepEqual(paintOf(night, id), paintOf(day, id), `${id} recoloured`);
    }
  });

  it('recolours every painted layer — no layer silently keeps its day paint', () => {
    // The night transform is a rule (`nightPaintFor`), not a list: it either
    // returns a recoloured paint or null, and a null on a layer the day style
    // paints is a colour that would render in daylight on a black map. This is
    // the check that catches a new day layer nobody gave a night colour to.
    const painted = day.layers.filter((layer) => layer.paint !== undefined);
    assert.ok(painted.length >= 20, `expected a painted style, found ${painted.length} painted layers`);
    for (const layer of painted as unknown as Array<{ id: string; paint: Record<string, unknown> }>) {
      const nightPaint = nightPaintFor(layer);
      assert.ok(nightPaint, `${layer.id}: no night paint — it would stay in daytime colours`);
      assert.notDeepEqual(nightPaint, layer.paint, `${layer.id}: night paint must differ from the day paint`);
    }
  });

  it('carries no key and points at the one allowed host', () => {
    for (const source of Object.values(night.sources)) {
      assert.ok(source.url?.startsWith('https://tiles.openfreemap.org/'));
      assert.ok(!source.url?.includes('key='));
    }
  });

  it('the JSON committed under web/public is exactly the built object', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const nightJson = JSON.parse(
      readFileSync(join(here, '../../../public/map-styles/kidbus-night.json'), 'utf8'),
    );
    assert.deepEqual(nightJson, JSON.parse(JSON.stringify(night)));
  });
});
