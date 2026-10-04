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
import { KIDBUS_DAY_STYLE, KIDBUS_NIGHT_STYLE } from '@school-bus-tracking/map-assets';

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
    // Land, water, roads, casings, labels — the palette from the session brief.
    assert.equal(paintOf(night, 'background')['background-color'], '#202124');
    assert.equal(paintOf(night, 'water')['fill-color'], '#17263c');
    assert.equal(paintOf(night, 'waterway')['line-color'], '#17263c');
    assert.equal(paintOf(night, 'road-casings')['line-color'], '#202124');
    assert.equal((paintOf(night, 'road-fills')['line-color'] as unknown[]).at(-1), '#3c4043');
    assert.equal(paintOf(night, 'transportation_name')['text-color'], '#9aa0a6');
    assert.equal(paintOf(night, 'place')['text-color'], '#9aa0a6');
    assert.equal(paintOf(night, 'poi')['text-color'], '#9aa0a6');
    // day paints really were replaced on every layer that has one
    for (const layer of night.layers) {
      if (day.layers.find((d) => d.id === layer.id)?.paint) {
        assert.notDeepEqual(layer.paint, day.layers.find((d) => d.id === layer.id)?.paint, `${layer.id} recoloured`);
      }
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
