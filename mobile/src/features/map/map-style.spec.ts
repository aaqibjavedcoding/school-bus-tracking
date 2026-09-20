import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  DEFAULT_MAP_STYLE_URL,
  MAP_ATTRIBUTION,
  MAP_STYLE_ENV_VARIABLE,
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
    assert.equal(DEFAULT_MAP_STYLE_URL, 'https://tiles.openfreemap.org/styles/liberty');
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
    const selfHosted = 'https://tiles.schoolbustracking.example/styles/liberty';
    assert.equal(resolveMapStyleUrl(env(selfHosted)), selfHosted);
    assert.equal(warnings.length, 0);
  });

  it('trims surrounding whitespace from a valid override', () => {
    const selfHosted = 'https://tiles.schoolbustracking.example/styles/liberty';
    assert.equal(resolveMapStyleUrl(env(`  ${selfHosted}\n`)), selfHosted);
  });

  it('accepts an https override that carries a query (some hosts version the style)', () => {
    const url = 'https://tiles.example.org/styles/liberty?variant=2';
    assert.equal(resolveMapStyleUrl(env(url)), url);
    assert.equal(warnings.length, 0);
  });

  it('refuses an http override: default + exactly one warning', () => {
    assert.equal(
      resolveMapStyleUrl(env('http://tiles.example.org/styles/liberty')),
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
