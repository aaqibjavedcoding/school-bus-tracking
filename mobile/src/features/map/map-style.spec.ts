import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { KIDBUS_DAY_STYLE, KIDBUS_NIGHT_STYLE } from '@school-bus-tracking/map-assets';

import {
  BUNDLED_MAP_STYLES,
  DEFAULT_MAP_STYLE,
  DEFAULT_MAP_STYLE_URL,
  MAP_ATTRIBUTION,
  MAP_STYLE_ENV_VARIABLE,
  OFFLINE_FALLBACK_MAP_STYLE,
  OPENFREEMAP_GLYPHS_TEMPLATE,
  buildGlyphProbeUrl,
  collectTextFontStacks,
  encodeFontStack,
  glyphUrlTransforms,
  inspectMapStyle,
  isOfflineFallbackStyle,
  resolveMapStyleInput,
  resolveMapStyleUrl,
  restyleForRetry,
  apiOriginFromBaseUrl,
  resolveMapSpriteUrl,
  withNativeSprite,
  __resetMapStyleWarningsForTests,
  __resetSpriteWarningForTests,
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
  __resetSpriteWarningForTests();
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
  it('is the bundled KidBus day style object, with the night object bundled alongside it', () => {
    assert.equal(DEFAULT_MAP_STYLE, KIDBUS_DAY_STYLE);
    assert.equal(BUNDLED_MAP_STYLES.day, KIDBUS_DAY_STYLE);
    assert.equal(BUNDLED_MAP_STYLES.night, KIDBUS_NIGHT_STYLE);
    assert.equal(resolveMapStyleInput({}), KIDBUS_DAY_STYLE);
    assert.equal(resolveMapStyleInput(env('   ')), KIDBUS_DAY_STYLE);
    assert.equal(resolveMapStyleInput({}, 'dark'), KIDBUS_NIGHT_STYLE);
  });

  it('never uses a bare relative path as the native default', () => {
    assert.equal(
      typeof DEFAULT_MAP_STYLE === 'object' && DEFAULT_MAP_STYLE !== null,
      true,
      'the native default must be a bundled style object, not a URL',
    );
    assert.equal(
      DEFAULT_MAP_STYLE_URL.startsWith('/'),
      false,
      `a root-relative default cannot be resolved on native: ${DEFAULT_MAP_STYLE_URL}`,
    );
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
    assert.equal(resolveMapStyleInput(env('')), DEFAULT_MAP_STYLE);
    assert.equal(resolveMapStyleInput(env('   ')), DEFAULT_MAP_STYLE);
    assert.equal(warnings.length, 0);
  });

  it('keeps a valid URL override as a URL while invalid input falls back to the object', () => {
    const selfHosted = 'https://tiles.schoolbustracking.example/styles/bright';
    assert.equal(resolveMapStyleInput(env(selfHosted)), selfHosted);
    assert.equal(resolveMapStyleInput(env('garbage')), DEFAULT_MAP_STYLE);
    assert.equal(warnings.length, 1);
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

describe('the bundled offline fallback style (R3)', () => {
  it('is a version-8 style with a background layer and no sources', () => {
    assert.equal(OFFLINE_FALLBACK_MAP_STYLE.version, 8);
    assert.deepEqual(OFFLINE_FALLBACK_MAP_STYLE.sources, {});
    assert.equal(OFFLINE_FALLBACK_MAP_STYLE.layers.length, 1);
    assert.equal(OFFLINE_FALLBACK_MAP_STYLE.layers[0].type, 'background');
  });

  it('references no network at all — a fallback that needs one is not a fallback', () => {
    const serialised = JSON.stringify(OFFLINE_FALLBACK_MAP_STYLE);
    assert.equal(serialised.includes('http'), false, 'no URL of any kind in the fallback');
    assert.equal(serialised.includes('glyphs'), false, 'no glyph template to fetch');
    assert.equal(serialised.includes('sprite'), false, 'no sprite sheet to fetch');
  });

  it('is frozen and identified by reference', () => {
    assert.ok(Object.isFrozen(OFFLINE_FALLBACK_MAP_STYLE));
    assert.equal(isOfflineFallbackStyle(OFFLINE_FALLBACK_MAP_STYLE), true);
    assert.equal(
      isOfflineFallbackStyle(JSON.parse(JSON.stringify(OFFLINE_FALLBACK_MAP_STYLE))),
      false,
      'a copy with the same content is not THE fallback — identity is the signal',
    );
  });
});

describe('restyleForRetry (the re-set that actually re-sets)', () => {
  it('produces a different serialisation for the same logical style', () => {
    const style = { version: 8, sources: {}, layers: [] };
    const retried = restyleForRetry(style, 1);
    assert.notEqual(
      JSON.stringify(retried),
      JSON.stringify(style),
      'the engine bridge forwards JSON.stringify(mapStyle) — an identical string is a no-op re-set',
    );
  });

  it('carries the retry generation in style-legal root metadata', () => {
    const style = { version: 8, sources: {}, layers: [] };
    const retried = restyleForRetry(style, 3) as { metadata: Record<string, unknown> };
    assert.equal(retried.metadata['sbt:retry-generation'], 3);
  });

  it('preserves existing metadata and every other key', () => {
    const style = {
      version: 8,
      metadata: { 'openmaptiles:version': '3.x' },
      sources: { x: {} },
      layers: [{ id: 'a' }],
    };
    const retried = restyleForRetry(style, 2);
    const metadata = retried.metadata as Record<string, unknown>;
    assert.equal(metadata['openmaptiles:version'], '3.x');
    assert.equal(metadata['sbt:retry-generation'], 2);
    assert.deepEqual(retried.sources, style.sources);
    assert.deepEqual(retried.layers, style.layers);
  });

  it('replaces a non-object metadata slot rather than spreading it', () => {
    const style = { version: 8, metadata: 'openmaptiles', sources: {}, layers: [] };
    const retried = restyleForRetry(style, 1) as { metadata: Record<string, unknown> };
    assert.equal(retried.metadata['sbt:retry-generation'], 1);
    assert.equal(typeof retried.metadata, 'object');
  });
});

/**
 * The sprite on native (Session 7). The bundled styles use the same
 * root-relative sprite path the web app serves same-origin
 * (`/map-sprites/kidbus`), and native MapLibre has no document origin to
 * resolve it against — so the pipeline resolves it against the API origin, the
 * one origin the app already trusts, and never against a third-party host.
 *
 * These cases are the whole rule: absolute stays absolute, a root-relative path
 * gains the API origin, and a style that cannot be resolved loses the field and
 * says so once rather than handing MapLibre a path it could only fail on.
 */
describe('the sprite URL on native', () => {
  it('extracts an origin from an API base URL, and strips any credential', () => {
    assert.equal(apiOriginFromBaseUrl('https://api.example.com/api/v1'), 'https://api.example.com');
    assert.equal(apiOriginFromBaseUrl('http://192.168.1.20:3001/api/v1'), 'http://192.168.1.20:3001');
    assert.equal(apiOriginFromBaseUrl('https://user:secret@api.example.com/api/v1'), 'https://api.example.com');
    assert.equal(apiOriginFromBaseUrl('  https://api.example.com/api/v1  '), 'https://api.example.com');
    assert.equal(apiOriginFromBaseUrl(''), null);
    assert.equal(apiOriginFromBaseUrl('   '), null);
    assert.equal(apiOriginFromBaseUrl(null), null);
    assert.equal(apiOriginFromBaseUrl(undefined), null);
    assert.equal(apiOriginFromBaseUrl('api.example.com'), null, 'a bare host is not an origin');
    assert.equal(apiOriginFromBaseUrl('file:///tmp/api'), null, 'only http(s) origins serve the sprite');
  });

  it('resolves the shipped sprite path against that origin', () => {
    assert.equal(
      resolveMapSpriteUrl('/map-sprites/kidbus', 'https://api.example.com/api/v1'),
      'https://api.example.com/map-sprites/kidbus',
    );
    // A dev LAN API is http, and the sprite follows it: same origin, same trust
    // level, same server that is already answering every other request.
    assert.equal(
      resolveMapSpriteUrl('/map-sprites/kidbus', 'http://192.168.1.20:3001'),
      'http://192.168.1.20:3001/map-sprites/kidbus',
    );
    // A self-hoster who pins their own absolute sprite keeps it verbatim.
    assert.equal(
      resolveMapSpriteUrl('https://tiles.example.org/sprites/kidbus', 'https://api.example.com'),
      'https://tiles.example.org/sprites/kidbus',
    );
    // Nothing else is rewritten.
    assert.equal(resolveMapSpriteUrl('//cdn.example.com/sprite', 'https://api.example.com'), '//cdn.example.com/sprite');
  });

  it('reports an unresolvable sprite instead of guessing one', () => {
    assert.equal(resolveMapSpriteUrl('/map-sprites/kidbus', null), '');
    assert.equal(resolveMapSpriteUrl('/map-sprites/kidbus', 'not-a-url'), '');
  });

  it('hands the engine a fetched-and-inspected style with a fetchable sprite', () => {
    const resolved = withNativeSprite(KIDBUS_DAY_STYLE, 'https://api.example.com/api/v1') as {
      sprite: string;
      sources: unknown;
      layers: unknown;
    };
    assert.equal(resolved.sprite, 'https://api.example.com/map-sprites/kidbus');
    // Only the sprite moved: sources and layers are the same objects.
    assert.equal(resolved.sources, KIDBUS_DAY_STYLE.sources);
    assert.equal(resolved.layers, KIDBUS_DAY_STYLE.layers);
    // …and the bundled constant itself is untouched (web reads the same shape).
    assert.equal(KIDBUS_DAY_STYLE.sprite, '/map-sprites/kidbus');
  });

  it('leaves a style alone when there is nothing to resolve, and drops it when it cannot be', () => {
    const absolute = { version: 8, sprite: 'https://tiles.example.org/sprites/kidbus', layers: [] };
    assert.equal(withNativeSprite(absolute, 'https://api.example.com'), absolute);

    const noSprite = { version: 8, layers: [] };
    assert.equal(withNativeSprite(noSprite, 'https://api.example.com'), noSprite);

    // A URL input (an override before it is fetched) is not an object.
    assert.equal(withNativeSprite('https://tiles.example.org/style.json', 'https://api.example.com'), 'https://tiles.example.org/style.json');
  });

  it('warns exactly once when the sprite cannot be resolved, and drops only that field', () => {
    warnings = [];
    const stripped = withNativeSprite(KIDBUS_NIGHT_STYLE, null) as Record<string, unknown>;
    assert.equal('sprite' in stripped, false, 'a relative sprite would only 404 on the device');
    assert.match(String(warnings[0]), /sprite/);
    assert.match(String(warnings[0]), /EXPO_PUBLIC_API_URL/);
    assert.equal(warnings.length, 1);
    // Every other field survives — labels, stops, the route and the bus are
    // unaffected by a missing POI sprite, and that is what the warning says.
    assert.equal(stripped.glyphs, KIDBUS_NIGHT_STYLE.glyphs);
    assert.equal(stripped.layers, KIDBUS_NIGHT_STYLE.layers);
    withNativeSprite(KIDBUS_NIGHT_STYLE, null);
    assert.equal(warnings.length, 1, 'one warning per process, not per render');
    assert.equal(KIDBUS_NIGHT_STYLE.sprite, '/map-sprites/kidbus', 'the bundled object is never mutated');
  });
});

/**
 * The positive half of the provider rule on native: the sprite the styles name
 * is *ours* (same-origin on web, the API origin on the phone) — it is not a
 * third-party sprite CDN, and resolving it never introduces a new host.
 */
describe('the sprite stays on our own origins', () => {
  it('the bundled styles name a root-relative sprite and a keyless tile host', () => {
    for (const [name, style] of Object.entries(BUNDLED_MAP_STYLES)) {
      assert.equal(style.sprite, '/map-sprites/kidbus', `${name}: the sprite is ours to serve`);
      for (const source of Object.values(style.sources)) {
        assert.match(String(source.url), /^https:\/\/tiles\.openfreemap\.org\//);
        assert.doesNotMatch(String(source.url), /key=|api_key=/);
      }
      assert.match(style.glyphs, /^https:\/\/tiles\.openfreemap\.org\/fonts\//);
    }
  });

  it('resolving the sprite adds no host beyond the API origin', () => {
    const resolved = withNativeSprite(KIDBUS_DAY_STYLE, 'https://api.example.com/api/v1') as {
      sprite: string;
    };
    const url = new URL(resolved.sprite);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.origin, 'https://api.example.com');
    assert.equal(url.pathname, '/map-sprites/kidbus');
  });
});
