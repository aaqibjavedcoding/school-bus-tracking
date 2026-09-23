import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  DEFAULT_MAP_STYLE_URL,
  MAP_ATTRIBUTION,
  MAP_STYLE_ENV_VARIABLE,
  OPENFREEMAP_GLYPHS_TEMPLATE,
  buildGlyphProbeUrl,
  collectTextFontStacks,
  encodeFontStack,
  glyphUrlTransforms,
  inspectMapStyle,
  resolveMapStyleUrl,
  __resetMapStyleWarningsForTests,
} from './map-style.ts';

/**
 * The style-URL policy, pinned: the map loads OpenFreeMap over
 * OpenStreetMap by default, an https override is honoured, and a non-https
 * override is refused with a one-time warning rather than shipped.
 */

const env = (value: string | undefined) => ({ [MAP_STYLE_ENV_VARIABLE]: value });

let warnings: string[];
let realWarn: typeof console.warn;

beforeEach(() => {
  __resetMapStyleWarningsForTests();
  warnings = [];
  realWarn = console.warn;
  console.warn = (message: string) => {
    warnings.push(message);
  };
});

afterEach(() => {
  console.warn = realWarn;
  __resetMapStyleWarningsForTests();
});

describe('the default', () => {
  it('is the OpenFreeMap public style over OpenStreetMap data', () => {
    assert.equal(DEFAULT_MAP_STYLE_URL, 'https://tiles.openfreemap.org/styles/bright');
  });

  it('is https (the fallback must never be a plaintext downgrade)', () => {
    assert.ok(DEFAULT_MAP_STYLE_URL.startsWith('https://'));
  });

  it('carries the provider attribution the docs and policy guard claim', () => {
    assert.match(MAP_ATTRIBUTION, /OpenFreeMap/);
    assert.match(MAP_ATTRIBUTION, /OpenMapTiles/);
    assert.match(MAP_ATTRIBUTION, /OpenStreetMap/);
  });
});

describe('resolveMapStyleUrl', () => {
  it('uses the default when the variable is not set', () => {
    assert.equal(resolveMapStyleUrl({}), DEFAULT_MAP_STYLE_URL);
    assert.equal(warnings.length, 0);
  });

  it('uses the default when the variable is blank (an empty override is no override)', () => {
    assert.equal(resolveMapStyleUrl(env('')), DEFAULT_MAP_STYLE_URL);
    assert.equal(resolveMapStyleUrl(env('   ')), DEFAULT_MAP_STYLE_URL);
    assert.equal(warnings.length, 0);
  });

  it('returns an https override verbatim (self-hosted style switch)', () => {
    const selfHosted = 'https://tiles.schoolbustracking.example/styles/bright';
    assert.equal(resolveMapStyleUrl(env(selfHosted)), selfHosted);
    assert.equal(warnings.length, 0);
  });

  it('trims surrounding whitespace from a valid override', () => {
    const selfHosted = 'https://tiles.schoolbustracking.example/styles/bright';
    assert.equal(resolveMapStyleUrl(env(`  ${selfHosted}\n`)), selfHosted);
  });

  it('accepts an https override that carries a query (some hosts version the style)', () => {
    const url = 'https://tiles.example.org/styles/bright?variant=2';
    assert.equal(resolveMapStyleUrl(env(url)), url);
    assert.equal(warnings.length, 0);
  });

  it('refuses an http override: default + exactly one warning', () => {
    assert.equal(
      resolveMapStyleUrl(env('http://tiles.example.org/styles/bright')),
      DEFAULT_MAP_STYLE_URL,
    );
    assert.equal(warnings.length, 1, 'a misconfigured override must be said, not shipped');
    assert.match(warnings[0], /https/);
    assert.match(warnings[0], new RegExp(MAP_STYLE_ENV_VARIABLE));
  });

  it('refuses non-URL values (bare host, ftp, garbage) the same way', () => {
    for (const bad of ['tiles.example.org', 'ftp://tiles.example.org/style.json', 'liberty']) {
      __resetMapStyleWarningsForTests();
      warnings = [];
      assert.equal(resolveMapStyleUrl(env(bad)), DEFAULT_MAP_STYLE_URL);
      assert.equal(warnings.length, 1, `expected one warning for ${bad}`);
    }
  });

  it('warns exactly once across repeated bad reads (bundle-time, not per-render)', () => {
    assert.equal(resolveMapStyleUrl(env('http://a.example/s')), DEFAULT_MAP_STYLE_URL);
    assert.equal(resolveMapStyleUrl(env('http://b.example/s')), DEFAULT_MAP_STYLE_URL);
    assert.equal(resolveMapStyleUrl({}), DEFAULT_MAP_STYLE_URL);
    assert.equal(warnings.length, 1);
  });

  it('keeps a later good override clean after an earlier bad one', () => {
    resolveMapStyleUrl(env('http://a.example/s'));
    assert.equal(resolveMapStyleUrl(env('https://b.example/s')), 'https://b.example/s');
    assert.equal(warnings.length, 1);
  });
});

/**
 * Glyph / label health, pinned: the fontstack request is percent-encoded
 * (maplibre-native Android drops labels over space-broken glyph paths), a
 * missing or non-https `glyphs` template is repaired to the canonical
 * OpenFreeMap fonts endpoint, and every style's declared text stacks are
 * discovered so no layer can fall back to the 404-ing default stack silently.
 */
describe('map-style glyph helpers', () => {
  it('encodes fontstack path segments: spaces only, commas preserved', () => {
    assert.equal(encodeFontStack('Noto Sans Regular'), 'Noto%20Sans%20Regular');
    assert.equal(
      encodeFontStack('Open Sans Regular,Arial Unicode MS Regular'),
      'Open%20Sans%20Regular,Arial%20Unicode%20MS%20Regular',
    );
  });

  it('builds the exact probe URL the engine should request', () => {
    assert.equal(
      buildGlyphProbeUrl(OPENFREEMAP_GLYPHS_TEMPLATE, 'Noto Sans Regular'),
      'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf',
    );
  });

  it('collects the unique text-font stacks of symbol layers only', () => {
    const stacks = collectTextFontStacks({
      layers: [
        { id: 'bg', type: 'background' },
        { id: 'road', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } },
        { id: 'place', type: 'symbol', layout: { 'text-font': ['Noto Sans Regular'] } },
        { id: 'shield', type: 'symbol', layout: { 'text-font': ['Noto Sans Bold'] } },
        { id: 'nameless', type: 'symbol', layout: {} },
      ],
    });
    assert.deepEqual(stacks, ['Noto Sans Regular', 'Noto Sans Bold']);
  });

  it('repairs a missing or non-https glyphs template to the canonical endpoint', () => {
    const missing = inspectMapStyle({ layers: [] });
    assert.equal(missing.glyphsRepaired, true);
    assert.equal(missing.glyphsTemplate, OPENFREEMAP_GLYPHS_TEMPLATE);
    assert.equal((missing.style as { glyphs?: string }).glyphs, OPENFREEMAP_GLYPHS_TEMPLATE);

    const plaintext = inspectMapStyle({ glyphs: 'http://tiles.example/fonts/{fontstack}/{range}.pbf' });
    assert.equal(plaintext.glyphsRepaired, true);
    assert.equal(plaintext.glyphsTemplate, OPENFREEMAP_GLYPHS_TEMPLATE);
  });

  it('keeps an intact https template untouched (CDN caching preserved)', () => {
    const intact = inspectMapStyle({
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      layers: [{ type: 'symbol', layout: { 'text-font': ['Noto Sans Italic'] } }],
    });
    assert.equal(intact.glyphsRepaired, false);
    assert.equal(intact.glyphsTemplate, 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    assert.deepEqual(intact.fontStacks, ['Noto Sans Italic']);
  });

  it('reports a non-object style as uninspectable (the caller raises styleLoad)', () => {
    assert.equal(inspectMapStyle('nope').glyphsTemplate, null);
    assert.equal(inspectMapStyle(null).glyphsTemplate, null);
    assert.equal(inspectMapStyle([1, 2]).glyphsTemplate, null);
  });

  it('emits one idempotent, id-stable transform per stack (raw form only)', () => {
    assert.deepEqual(glyphUrlTransforms(['Noto Sans Regular', 'Noto Sans Bold']), [
      { id: 'sbt-glyph-0', find: 'Noto Sans Regular', replace: 'Noto%20Sans%20Regular' },
      { id: 'sbt-glyph-1', find: 'Noto Sans Bold', replace: 'Noto%20Sans%20Bold' },
    ]);
    // `find` matches the unencoded request form only — applying the rewrite
    // to an already-encoded URL is a no-op, so the pipeline cannot double
    // encode (`%2520`).
    assert.equal('Noto%20Sans%20Regular'.replace('Noto Sans Regular', 'x'), 'Noto%20Sans%20Regular');
  });
});
