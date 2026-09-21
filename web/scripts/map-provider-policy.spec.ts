import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * Web map-provider policy guard — mirrors mobile/scripts/map-provider-policy.spec.ts.
 *
 * The web console map must NEVER depend on an API key, credit card, billing or
 * metered tier. Allowed: maplibre-gl + OpenFreeMap (https://tiles.openfreemap.org).
 * Banned: leaflet, react-leaflet, tile.openstreetmap.org, Google Maps, Mapbox,
 * MapTiler, Stadia, Geoapify, or any map URL carrying key=/api_key=.
 *
 * Scans web/src, web/package.json and web/next.config.js + security-headers.js.
 * Fails if banned provider appears; asserts maplibre-gl present.
 */

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const BANNED_IMPORT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/from\s+['\"]leaflet['\"]/i, 'leaflet (use maplibre-gl instead)'],
  [/from\s+['\"]react-leaflet['\"]/i, 'react-leaflet (use maplibre-gl instead)'],
  [/require\s*\(\s*['\"]leaflet['\"]\s*\)/i, 'leaflet (use maplibre-gl instead)'],
  [/require\s*\(\s*['\"]react-leaflet['\"]\s*\)/i, 'react-leaflet (use maplibre-gl instead)'],
  [/['\"]leaflet['\"]\s*:/i, 'leaflet dependency in package.json (use maplibre-gl)'],
  [/['\"]react-leaflet['\"]\s*:/i, 'react-leaflet dependency in package.json'],
];

const BANNED_URL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/tile\.openstreetmap\.org/i, 'tile.openstreetmap.org (OSMF forbids heavy use; use OpenFreeMap)'],
];

const BANNED_PROVIDER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/maps\.googleapis\.com/i, 'the Google Maps API endpoint'],
  [/mapbox/i, 'Mapbox (key + metered)'],
  [/maptiler/i, 'MapTiler (account + metered)'],
  [/stadiamaps/i, 'Stadia Maps (key + metered)'],
  [/geoapify/i, 'Geoapify (key + metered)'],
  [/google\.maps/i, 'Google Maps (key + billing)'],
];

const SCAN_FILES = ['package.json', 'next.config.js', 'security-headers.js'] as const;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        ['node_modules', '.next', 'dist', '.turbo', 'coverage', '__pycache__'].includes(entry.name)
      )
        continue;
      yield* walk(path);
    } else if (entry.isFile()) {
      if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name)) yield path;
    }
  }
}

function filesToScan(): string[] {
  const configFiles = SCAN_FILES.map((name) => join(webRoot, name)).filter((p) => existsSync(p));
  const srcFiles = [...walk(join(webRoot, 'src'))];
  return [...configFiles, ...srcFiles];
}

function bannedProviderViolations(file: string, content: string): string[] {
  const hits: string[] = [];
  if (file.endsWith('map-provider-policy.spec.ts')) return hits;

  const lines = content.split('\n');
  lines.forEach((line, i) => {
    for (const [pattern, reason] of BANNED_IMPORT_PATTERNS) {
      if (pattern.test(line)) {
        hits.push(`${file}:${i + 1}  ${reason}\n    ${line.trim().slice(0, 120)}`);
      }
    }
    for (const [pattern, reason] of BANNED_URL_PATTERNS) {
      if (pattern.test(line)) {
        hits.push(`${file}:${i + 1}  ${reason}\n    ${line.trim().slice(0, 120)}`);
      }
    }
    for (const [pattern, reason] of BANNED_PROVIDER_PATTERNS) {
      if (pattern.test(line)) {
        if (/maps\.google\.com/i.test(line)) continue;
        hits.push(`${file}:${i + 1}  ${reason}\n    ${line.trim().slice(0, 120)}`);
      }
    }
  });

  return hits;
}

function keyedUrlViolations(file: string, content: string): string[] {
  const hits: string[] = [];
  if (file.endsWith('map-provider-policy.spec.ts')) return hits;
  for (const match of content.matchAll(/https?:\/\/[^\s'\"`)}\]]+/g)) {
    if (/[?&](api_)?key=/i.test(match[0])) {
      hits.push(`${file}  a URL carries a key credential: ${match[0]}`);
    }
  }
  return hits;
}

describe('web map provider policy (no key, no card, no billing — off tile.openstreetmap.org)', () => {
  it('scans the intended locations', () => {
    for (const name of SCAN_FILES) {
      const p = join(webRoot, name);
      if (name === 'package.json') {
        assert.ok(existsSync(p), `missing scan target: ${name}`);
      }
    }
    const srcFiles = filesToScan().filter((f) => f.includes('/src/'));
    assert.ok(
      srcFiles.length > 50,
      `src/ unexpectedly small (${srcFiles.length} files) — scan broken?`,
    );
  });

  it('the scanner still detects a banned provider (self-test)', () => {
    assert.ok(bannedProviderViolations('x.ts', 'import L from \"leaflet\";').length === 1);
    assert.ok(
      bannedProviderViolations('x.ts', 'import { MapContainer } from \"react-leaflet\";').length,
    );
    assert.ok(
      bannedProviderViolations('x.ts', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').length,
    );
    assert.ok(
      bannedProviderViolations('x.ts', 'https://api.maptiler.com/maps/basic/style.json').length,
    );
    assert.equal(
      bannedProviderViolations('x.ts', 'const ok = \"tiles.openfreemap.org\";').length,
      0,
    );
    assert.equal(
      bannedProviderViolations('x.ts', "'https://maps.google.com/maps?daddr=' + dest").length,
      0,
    );
    // Casual mention in comment should NOT be flagged as leaflet import
    assert.equal(bannedProviderViolations('x.ts', '// no Leaflet here, uses MapLibre').length, 0);
  });

  it('the scanner still detects a keyed URL (self-test)', () => {
    assert.ok(keyedUrlViolations('x.ts', 'https://tiles.example.com/style.json?key=abc123').length);
    assert.ok(
      keyedUrlViolations('x.ts', 'https://tiles.example.com/style.json?foo=1&api_key=abc').length,
    );
    assert.equal(
      keyedUrlViolations('x.ts', 'https://tiles.openfreemap.org/styles/liberty').length,
      0,
    );
  });

  it('no banned map provider in package.json, next.config.js, security-headers.js or src/', () => {
    const violations = filesToScan().flatMap((file) => {
      try {
        return bannedProviderViolations(file, readFileSync(file, 'utf8'));
      } catch {
        return [];
      }
    });
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('no URL in the scan set carries a key= / api_key= credential', () => {
    const violations = filesToScan().flatMap((file) => {
      try {
        return keyedUrlViolations(file, readFileSync(file, 'utf8'));
      } catch {
        return [];
      }
    });
    assert.deepEqual(violations, [], violations.join('\n'));
  });

  it('the open-source stack is actually present (deleting both is not compliance)', () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    assert.ok(
      pkg.dependencies['maplibre-gl'],
      'maplibre-gl dependency missing in web/package.json',
    );
    const mapStylePath = join(webRoot, 'src/features/map/map-style.ts');
    assert.ok(existsSync(mapStylePath), 'web/src/features/map/map-style.ts missing');
    const content = readFileSync(mapStylePath, 'utf8');
    assert.match(content, /tiles\.openfreemap\.org/, 'map-style.ts must default to OpenFreeMap');
    assert.match(
      content,
      /NEXT_PUBLIC_MAP_STYLE_URL/,
      'map-style.ts must read NEXT_PUBLIC_MAP_STYLE_URL',
    );
  });

  it('CSP pins OpenFreeMap and no longer allows tile.openstreetmap.org', () => {
    const cspPath = join(webRoot, 'security-headers.js');
    const cspContent = readFileSync(cspPath, 'utf8');
    assert.match(cspContent, /tiles\.openfreemap\.org/, 'CSP must allow tiles.openfreemap.org');
    assert.doesNotMatch(
      cspContent,
      /tile\.openstreetmap\.org/,
      'CSP must NOT allow tile.openstreetmap.org',
    );

    const mod = require(cspPath) as {
      buildContentSecurityPolicy: (opts: unknown) => string;
    };
    const built = mod.buildContentSecurityPolicy({ isProduction: true }) as string;
    const imgSrc = built.split(';').find((d) => d.trim().startsWith('img-src')) ?? '';
    const connectSrc = built.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';
    assert.match(imgSrc, /tiles\.openfreemap\.org/, 'built img-src must include OpenFreeMap');
    assert.match(
      connectSrc,
      /tiles\.openfreemap\.org/,
      'built connect-src must include OpenFreeMap',
    );
    assert.ok(!imgSrc.includes('*'), `built img-src must not use wildcard: ${imgSrc}`);
    assert.ok(!connectSrc.includes('*'), `built connect-src must not use wildcard: ${connectSrc}`);
    assert.doesNotMatch(imgSrc, /tile\.openstreetmap\.org/);
    assert.doesNotMatch(connectSrc, /tile\.openstreetmap\.org/);
  });
});
