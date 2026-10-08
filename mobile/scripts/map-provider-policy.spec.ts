import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_MAP_STYLES,
  MAP_ATTRIBUTION,
  apiOriginFromBaseUrl,
  resolveMapSpriteUrl,
  withNativeSprite,
} from '../src/features/map/map-style.ts';

/**
 * Map-provider policy guard — the product rule, enforced by the test suite.
 *
 * The map must NEVER depend on an API key, a credit card, billing or a
 * metered tier. Google Maps, MapTiler, Stadia, Geoapify and Mapbox are all
 * out; the map is @maplibre/maplibre-react-native (open source) over
 * OpenFreeMap's public OpenStreetMap tiles — see
 * `docs/live-tracking-map.md` → "Map provider policy".
 *
 * This spec fails if a banned provider reappears anywhere in the mobile
 * config (`package.json`, `app.config.js`, `app.json`) or in `src/`, or if
 * any URL in those files carries a `key=` / `api_key=` credential (a tile
 * URL that needs a key is, by definition, a metered provider in disguise).
 *
 * Scope note: this file lives in `scripts/` and contains the banned tokens
 * as literal patterns, so the scan set is exactly the four locations above —
 * `scripts/`, `web/` and the docs are deliberately not scanned (the docs may
 * NAME the banned providers to say why they were rejected).
 */

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pattern → the reason it is banned (shown in the failure message). */
const BANNED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/react-native-maps/i, 'react-native-maps (the platform-provider map library)'],
  [/google.?maps/i, 'Google Maps (key on Android, billed meters on iOS)'],
  [/maps\.googleapis\.com/i, 'the Google Maps API endpoint'],
  [/mapbox/i, 'Mapbox (key + metered)'],
  [/maptiler/i, 'MapTiler (account + metered)'],
  [/stadiamaps/i, 'Stadia Maps (key + metered)'],
  [/geoapify/i, 'Geoapify (key + metered)'],
];

const SCAN_FILES = ['package.json', 'app.config.js', 'app.json'] as const;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** The full scan set: the three config files plus every file under src/. */
function filesToScan(): string[] {
  return [...SCAN_FILES.map((name) => join(mobileRoot, name)), ...walk(join(mobileRoot, 'src'))];
}

/** Banned-provider hits, one entry per offending line. */
function bannedProviderViolations(file: string, content: string): string[] {
  const hits: string[] = [];
  content.split('\n').forEach((line, i) => {
    for (const [pattern, reason] of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        hits.push(`${file}:${i + 1}  ${reason}\n    ${line.trim().slice(0, 100)}`);
      }
    }
  });
  return hits;
}

/** URLs in the content that carry a `key=` / `api_key=` query credential. */
function keyedUrlViolations(file: string, content: string): string[] {
  const hits: string[] = [];
  for (const match of content.matchAll(/https?:\/\/[^\s'"`)}\]]+/g)) {
    if (/[?&](api_)?key=/i.test(match[0])) {
      hits.push(`${file}  a URL carries a key credential: ${match[0]}`);
    }
  }
  return hits;
}

describe('map provider policy (no key, no card, no billing — the product rule)', () => {
  it('scans the intended locations (the set is not silently narrowed)', () => {
    for (const name of SCAN_FILES) {
      assert.ok(existsSync(join(mobileRoot, name)), `missing scan target: ${name}`);
    }
    const srcFiles = filesToScan().length - SCAN_FILES.length;
    assert.ok(srcFiles > 100, `src/ unexpectedly small (${srcFiles} files) — scan broken?`);
  });

  it('the scanner still detects a banned provider (self-test)', () => {
    assert.ok(
      bannedProviderViolations('x.ts', 'import MapView from "react-native-maps";').length === 1,
    );
    assert.ok(
      bannedProviderViolations('x.ts', 'const k = EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;').length,
    );
    assert.ok(
      bannedProviderViolations('x.ts', 'https://api.maptiler.com/maps/basic/style.json').length,
    );
    assert.equal(bannedProviderViolations('x.ts', 'const ok = "tiles.openfreemap.org";').length, 0);
    // maps.google.com (the Navigate hand-off) is a directions deep link, not a
    // Maps SDK dependency — the pattern must not catch it.
    assert.equal(
      bannedProviderViolations('x.ts', "'https://maps.google.com/maps?daddr=' + dest").length,
      0,
    );
  });

  it('the scanner still detects a keyed URL (self-test)', () => {
    assert.ok(keyedUrlViolations('x.ts', 'https://tiles.example.com/style.json?key=abc123').length);
    assert.ok(
      keyedUrlViolations('x.ts', 'https://tiles.example.com/style.json?foo=1&api_key=abc').length,
    );
    assert.equal(
      keyedUrlViolations('x.ts', 'https://tiles.openfreemap.org/styles/bright').length,
      0,
    );
  });

  it('no banned map provider in package.json, app.config.js, app.json or src/', () => {
    const violations = filesToScan().flatMap((file) =>
      bannedProviderViolations(file, readFileSync(file, 'utf8')),
    );
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('no URL in the scan set carries a key= / api_key= credential', () => {
    const violations = filesToScan().flatMap((file) =>
      keyedUrlViolations(file, readFileSync(file, 'utf8')),
    );
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('the open-source stack is actually present (deleting both is not compliance)', () => {
    const pkg = JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    assert.ok(pkg.dependencies['@maplibre/maplibre-react-native'], '@maplibre dependency missing');
    assert.match(
      readFileSync(join(mobileRoot, 'app.config.js'), 'utf8'),
      /@maplibre\/maplibre-react-native/,
      'the MapLibre config plugin must stay wired in app.config.js',
    );
  });
});

/**
 * The positive half of the same rule. A scan for banned tokens passes on an
 * empty style, on a sprite nobody serves and on a style that grew a second
 * provider — so the things that must be TRUE are asserted too, not only the
 * things that must be absent.
 */
describe('the free stack is actually wired (positive assertions)', () => {
  it('the bundled styles read the one keyless OpenFreeMap source, glyphs included', () => {
    for (const [name, style] of Object.entries(BUNDLED_MAP_STYLES)) {
      const sources = Object.entries(style.sources);
      assert.equal(sources.length, 1, `${name}: one source, so a second provider cannot hide here`);
      const [, source] = sources[0];
      assert.equal(source.type, 'vector', `${name}: the free OpenFreeMap planet source is vector`);
      assert.ok(
        source.url?.startsWith('https://tiles.openfreemap.org/'),
        `${name}: source url must be the keyless OpenFreeMap host, got ${source.url}`,
      );
      assert.ok(!source.url?.includes('key='), `${name}: no credential on the tile URL`);
      assert.match(style.glyphs, /^https:\/\/tiles\.openfreemap\.org\/fonts\//, `${name}: glyphs`);
      assert.match(MAP_ATTRIBUTION, /OpenFreeMap/);
      assert.match(MAP_ATTRIBUTION, /OpenStreetMap/);
    }
  });

  it('the sprite is served by us — same-origin on web, the API origin on native', () => {
    for (const [name, style] of Object.entries(BUNDLED_MAP_STYLES)) {
      assert.equal(style.sprite, '/map-sprites/kidbus', `${name}: the sprite path is ours`);
      assert.doesNotMatch(String(style.sprite), /^[a-z]+:\/\//i, `${name}: never a third-party sprite host`);
    }
    // Native cannot resolve a root-relative path, so the pipeline hands it the
    // API origin — the same origin that already serves the app, and the same
    // origin the web app serves the identical sprite files from.
    const origin = apiOriginFromBaseUrl('https://api.example.com/api/v1');
    assert.equal(origin, 'https://api.example.com');
    const spriteUrl = resolveMapSpriteUrl(BUNDLED_MAP_STYLES.day.sprite, origin);
    assert.equal(spriteUrl, 'https://api.example.com/map-sprites/kidbus');
    assert.ok(!/key=|api_key=/.test(spriteUrl), 'no credential ever rides the sprite URL');
    // Resolving never adds a host of its own, and never a wildcard.
    const withSprite = withNativeSprite(BUNDLED_MAP_STYLES.day, origin) as { sprite: string };
    assert.equal(new URL(withSprite.sprite).host, 'api.example.com');
    for (const banned of ['maptiler', 'mapbox', 'stadiamaps', 'geoapify', 'googleapis']) {
      assert.ok(!spriteUrl.includes(banned), `the sprite must never come from ${banned}`);
    }
  });

  it('the sprite the phone asks for is the sprite this repository ships', () => {
    // The web app serves `web/public/` from the API origin, so the absolute
    // native URL lands on these exact files — pinned here because a rename of
    // the sprite file would otherwise only show up as missing icons on a phone.
    const spriteDir = join(mobileRoot, '..', 'web', 'public', 'map-sprites');
    for (const file of ['kidbus.json', 'kidbus.png', 'kidbus@2x.json', 'kidbus@2x.png']) {
      assert.ok(existsSync(join(spriteDir, file)), `missing shipped sprite file: ${file}`);
    }
    const index = JSON.parse(readFileSync(join(spriteDir, 'kidbus.json'), 'utf8')) as Record<string, unknown>;
    const dayIconIds = JSON.stringify(BUNDLED_MAP_STYLES.day).match(/"poi-[a-z_]+"/g) ?? [];
    assert.ok(dayIconIds.length > 0, 'the bundled style must name sprite ids (the POI layer)');
    for (const quoted of new Set(dayIconIds)) {
      const id = quoted.replace(/"/g, '');
      assert.ok(id in index, `the style names "${id}", which the shipped sprite does not contain`);
    }
  });
});
