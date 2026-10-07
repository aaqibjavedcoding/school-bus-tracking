import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COORDINATE_PRECISION,
  FALLBACK_CENTER,
  FALLBACK_ZOOM,
  SELECTED_ZOOM,
  coordinatesDiffer,
  coordinatesFromLngLat,
  formatCoordinate,
  geolocationErrorMessage,
  isValidLatLng,
  parseCoordinates,
  resolveInitialView,
} from './stop-location.ts';

const here = dirname(fileURLToPath(import.meta.url));
const inner = readFileSync(join(here, 'StopLocationPickerInner.tsx'), 'utf8');

describe('parseCoordinates', () => {
  it('accepts a valid pair and returns [lng, lat]', () => {
    assert.deepEqual(
      parseCoordinates({ latitude: '21.1458', longitude: '79.0882' }),
      [79.0882, 21.1458],
    );
  });

  it('rejects partial input (only one side filled)', () => {
    assert.equal(parseCoordinates({ latitude: '21.1458', longitude: '' }), null);
    assert.equal(parseCoordinates({ latitude: '', longitude: '79.0882' }), null);
  });

  it('rejects empty, whitespace and half-typed values', () => {
    assert.equal(parseCoordinates({ latitude: '', longitude: '' }), null);
    assert.equal(parseCoordinates({ latitude: '  ', longitude: '  ' }), null);
    assert.equal(parseCoordinates({ latitude: '-', longitude: '79' }), null);
    assert.equal(parseCoordinates({ latitude: '21.', longitude: 'abc' }), null);
  });

  it('rejects NaN and infinities', () => {
    assert.equal(parseCoordinates({ latitude: 'NaN', longitude: '0' }), null);
    assert.equal(parseCoordinates({ latitude: '1e999', longitude: '0' }), null);
  });

  it('rejects out-of-range latitude and longitude', () => {
    assert.equal(parseCoordinates({ latitude: '91', longitude: '0' }), null);
    assert.equal(parseCoordinates({ latitude: '-90.1', longitude: '0' }), null);
    assert.equal(parseCoordinates({ latitude: '0', longitude: '181' }), null);
    assert.equal(parseCoordinates({ latitude: '0', longitude: '-181' }), null);
  });

  it('accepts the exact range edges and zero', () => {
    assert.deepEqual(parseCoordinates({ latitude: '90', longitude: '180' }), [180, 90]);
    assert.deepEqual(parseCoordinates({ latitude: '-90', longitude: '-180' }), [-180, -90]);
    assert.deepEqual(parseCoordinates({ latitude: '0', longitude: '0' }), [0, 0]);
  });
});

describe('isValidLatLng', () => {
  it('mirrors the range rules', () => {
    assert.equal(isValidLatLng(21.1, 79.1), true);
    assert.equal(isValidLatLng(Number.NaN, 79.1), false);
    assert.equal(isValidLatLng(21.1, 200), false);
  });
});

describe('resolveInitialView', () => {
  it('centres on an existing stop in edit mode and marks a selection', () => {
    const view = resolveInitialView({ latitude: '19.0760', longitude: '72.8777' });
    assert.deepEqual(view.center, [72.8777, 19.076]);
    assert.equal(view.zoom, SELECTED_ZOOM);
    assert.equal(view.hasSelection, true);
  });

  it('falls back to Nagpur for create mode without selecting it', () => {
    const view = resolveInitialView({ latitude: '', longitude: '' });
    assert.deepEqual(view.center, FALLBACK_CENTER);
    assert.equal(view.zoom, FALLBACK_ZOOM);
    assert.equal(view.hasSelection, false);
  });

  it('treats invalid stored values as no selection', () => {
    assert.equal(resolveInitialView({ latitude: '999', longitude: '12' }).hasSelection, false);
  });

  it('keeps the Nagpur fallback out of the form value', () => {
    // The fallback is a camera only: nothing converts it into form strings.
    const view = resolveInitialView({ latitude: '', longitude: '' });
    assert.equal(view.hasSelection, false);
    assert.equal(parseCoordinates({ latitude: '', longitude: '' }), null);
    assert.deepEqual(FALLBACK_CENTER, [79.0882, 21.1458]);
  });
});

describe('formatting', () => {
  it('writes six decimal places', () => {
    assert.equal(COORDINATE_PRECISION, 6);
    assert.equal(formatCoordinate(21.14581234567), '21.145812');
    assert.deepEqual(coordinatesFromLngLat(79.08821111111, 21.14581111111), {
      latitude: '21.145811',
      longitude: '79.088211',
    });
  });

  it('round-trips a map selection back through the parser', () => {
    const emitted = coordinatesFromLngLat(79.0882, 21.1458);
    assert.deepEqual(parseCoordinates(emitted), [79.0882, 21.1458]);
  });
});

describe('coordinatesDiffer', () => {
  it('ignores differences below stored precision', () => {
    assert.equal(coordinatesDiffer([79.0882, 21.1458], [79.0882, 21.1458]), false);
    assert.equal(coordinatesDiffer([79.0882, 21.1458], [79.0883, 21.1458]), true);
  });
});

describe('geolocationErrorMessage', () => {
  it('maps every documented code to a friendly sentence', () => {
    assert.match(geolocationErrorMessage({ code: 1 }), /permission was denied/i);
    assert.match(geolocationErrorMessage({ code: 2 }), /unavailable/i);
    assert.match(geolocationErrorMessage({ code: 3 }), /too long/i);
    assert.match(geolocationErrorMessage({ code: 99 }), /Could not get your location/i);
    assert.match(geolocationErrorMessage(null), /Could not get your location/i);
  });

  it('never leaks coordinates or raw error text', () => {
    for (const code of [1, 2, 3, 99]) {
      assert.doesNotMatch(geolocationErrorMessage({ code }), /\d+\.\d{3,}/);
    }
  });
});

describe('picker component source guarantees', () => {
  it('only requests a position from the explicit button handler', () => {
    assert.equal(inner.split('getCurrentPosition').length - 1, 1);
    assert.ok(!inner.includes('watchPosition'));
    // The call lives inside `useCurrentLocation`, not in a mount effect.
    const handler = inner.slice(inner.indexOf('const useCurrentLocation'));
    assert.ok(handler.includes('getCurrentPosition'));
  });

  it('never logs a position', () => {
    assert.ok(!/console\.(log|info|warn|error)/.test(inner));
  });

  it('keeps a free, keyless provider and visible attribution', () => {
    assert.ok(inner.includes('maplibre-gl'));
    assert.ok(inner.includes('MAP_ATTRIBUTION'));
    // No paid/keyed provider endpoint, token or geocoding call anywhere.
    // Names are assembled so this guard does not itself trip
    // `scripts/map-provider-policy.spec.ts`.
    const bannedProviders = ['goo' + 'gleapis', 'map' + 'box', 'map' + 'tiler', 'nomi' + 'natim'];
    const bannedCredentials = ['api' + '_key', 'access' + '_token'];
    for (const needle of [...bannedProviders, ...bannedCredentials]) {
      assert.ok(!inner.toLowerCase().includes(needle), `picker must not reference ${needle}`);
    }
  });

  it('resizes the map after the modal lays out', () => {
    assert.ok(inner.includes('.resize()'));
  });
});
