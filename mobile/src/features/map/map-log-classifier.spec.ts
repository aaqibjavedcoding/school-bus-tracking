import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyMapLog } from './map-log-classifier.ts';

/**
 * The strict allow-list, pinned.
 *
 * The classifier this replaces called **any** warn/error log line containing
 * `style`, `maplibre` or `mbgl` a style-load failure. maplibre-native emits
 * those lines routinely on a healthy map, so a driver on a good network saw a
 * red "Map failed to load — check your network connection and map tiles" over
 * a map that was drawing perfectly. Every line below is real engine noise;
 * `null` is the right answer for almost all of it.
 */

describe('the noise that must never raise an issue', () => {
  const noise: [string, string, string][] = [
    ['warn', 'Mbgl-Style', 'Unsupported style property: fill-extrusion-vertical-gradient'],
    ['warn', 'MapLibre', 'Failed to load image: sprite icon "bus-15" not found'],
    ['warn', 'Mbgl-HttpRequest', 'Request failed: HTTP status code 404'],
    ['error', 'Mbgl-HttpRequest', 'Request cancelled: connection closed during pan'],
    ['warn', 'Mbgl', 'Style is still loading, deferring layer update'],
    ['warn', 'MapLibre', 'mbgl: tile 12/2345/1234 could not be parsed'],
    ['error', 'Mbgl-Glyph', 'Error loading glyph range 0-255 for Noto Sans Regular'],
    ['warn', 'Mbgl-Glyph', 'Failed to load glyphs range 256-511'],
    ['info', 'Mbgl-Style', 'Failed to load style'],
    ['debug', 'MapLibre', 'Failed to load style'],
  ];

  for (const [level, tag, message] of noise) {
    it(`ignores ${level} "${message.slice(0, 48)}…"`, () => {
      assert.equal(classifyMapLog(level, tag, message), null);
    });
  }

  it('ignores a warn log that merely mentions "maplibre"', () => {
    // The named acceptance case: a bare mention is not a diagnosis.
    assert.equal(classifyMapLog('warn', 'MapLibre', 'maplibre renderer initialised'), null);
    assert.equal(classifyMapLog('warn', null, 'mbgl surface recreated'), null);
    assert.equal(classifyMapLog('error', null, 'maplibre: something happened'), null);
  });

  it('ignores an empty or absent line', () => {
    assert.equal(classifyMapLog('error', null, null), null);
    assert.equal(classifyMapLog('error', '', '   '), null);
  });
});

describe('the genuinely fatal patterns', () => {
  it('recognises a style that failed to load', () => {
    assert.equal(
      classifyMapLog('error', 'Mbgl-Style', 'Failed to load style: connection refused'),
      'styleLoad',
    );
    assert.equal(classifyMapLog('error', null, 'Unable to fetch style JSON'), 'styleLoad');
    assert.equal(
      classifyMapLog('error', 'Mbgl', 'Error: style is not done loading'),
      'styleLoad',
    );
    assert.equal(classifyMapLog('error', null, 'Error parsing style: invalid JSON'), 'styleLoad');
  });

  it('recognises a style request that came back 4xx/5xx', () => {
    assert.equal(
      classifyMapLog(
        'error',
        'Mbgl-HttpRequest',
        'GET https://tiles.openfreemap.org/styles/bright failed, HTTP status code 503',
      ),
      'styleLoad',
    );
    assert.equal(
      classifyMapLog('error', null, 'style.json request failed with status 404'),
      'styleLoad',
    );
  });

  it('does not mistake an HTTP failure on a tile for the style', () => {
    assert.equal(
      classifyMapLog(
        'error',
        'Mbgl-HttpRequest',
        'GET https://tiles.openfreemap.org/planet/12/2345/1234.pbf failed, HTTP status code 404',
      ),
      null,
      'the line has to name the style resource, not just live on the same host',
    );
  });

  it('does not mistake a glyph 404 on a style host for the style', () => {
    assert.equal(
      classifyMapLog(
        'error',
        'Mbgl-HttpRequest',
        'GET https://tiles.openfreemap.org/styles/bright/fonts/Noto%20Sans/0-255.pbf, HTTP status code 404',
      ),
      null,
    );
  });

  it('recognises a fonts endpoint that is gone — but not one missing range', () => {
    assert.equal(classifyMapLog('error', 'Mbgl', 'Failed to load glyphs'), 'glyphs');
    assert.equal(classifyMapLog('error', 'Mbgl', 'glyphs url is missing'), 'glyphs');
    assert.equal(
      classifyMapLog('error', 'Mbgl', 'Failed to load glyphs for range 0-255'),
      null,
      'one missing range is not "labels unavailable"',
    );
  });
});
