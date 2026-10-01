import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapCameraPreferenceKey,
  loadMapCameraPreference,
  saveMapCameraPreference,
} from './map-camera-preferences.ts';
import {
  MAP_3D_PITCH,
  MAP_BUILDINGS_MIN_ZOOM,
  MAP_BUILDING_LAYER_ID,
  MAP_MAX_PITCH,
  createDroppedFrameGuard,
  defaultMapDimensionForRole,
  effectiveMapDimension,
  mapStyleForDimension,
  parseMapDimension,
} from '@school-bus-tracking/map-assets';

describe('shared 2D/3D camera policy', () => {
  it('defaults overview roles to 3D and the driver/unknown roles to safe 2D', () => {
    assert.equal(defaultMapDimensionForRole('SCHOOL_ADMIN'), '3d');
    assert.equal(defaultMapDimensionForRole('SUPER_ADMIN'), '3d');
    assert.equal(defaultMapDimensionForRole('PARENT'), '3d');
    assert.equal(defaultMapDimensionForRole('DRIVER'), '2d');
    assert.equal(defaultMapDimensionForRole('CONDUCTOR'), '2d');
    assert.equal(defaultMapDimensionForRole(null), '2d');
    assert.equal(MAP_3D_PITCH, 45);
    assert.equal(MAP_MAX_PITCH, 60);
  });

  it('accepts only persisted dimensions and forces accessibility/perf fallbacks flat', () => {
    assert.equal(parseMapDimension('2d'), '2d');
    assert.equal(parseMapDimension('3d'), '3d');
    assert.equal(parseMapDimension('3D'), null);
    assert.equal(parseMapDimension(null), null);
    assert.equal(effectiveMapDimension('3d', true, false), '2d');
    assert.equal(effectiveMapDimension('3d', false, true), '2d');
    assert.equal(effectiveMapDimension('3d', false, false), '3d');
  });

  it('falls back only after repeated active-render dropped frames, not an idle gap', () => {
    const guard = createDroppedFrameGuard({
      slowFrameMs: 40,
      requiredSlowFrames: 3,
      windowMs: 500,
      idleGapMs: 200,
    });
    assert.equal(guard.sample(0), false);
    assert.equal(guard.sample(50), false);
    assert.equal(guard.sample(100), false);
    assert.equal(guard.sample(150), true);

    guard.reset();
    assert.equal(guard.sample(0), false);
    assert.equal(guard.sample(500), false, 'background/idle gaps reset instead of counting');
    assert.equal(guard.sample(516), false);
  });
});

describe('per-user camera preference storage', () => {
  it('keeps account keys isolated and ignores invalid stored values', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    saveMapCameraPreference(storage, 'admin-1', '3d');
    saveMapCameraPreference(storage, 'driver-1', '2d');
    assert.equal(loadMapCameraPreference(storage, 'admin-1'), '3d');
    assert.equal(loadMapCameraPreference(storage, 'driver-1'), '2d');
    assert.notEqual(mapCameraPreferenceKey('admin-1'), mapCameraPreferenceKey('driver-1'));

    values.set(mapCameraPreferenceKey('admin-1'), 'sideways');
    assert.equal(loadMapCameraPreference(storage, 'admin-1'), null);
  });

  it('degrades safely when browser storage is unavailable', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(loadMapCameraPreference(blocked, 'parent-1'), null);
    assert.doesNotThrow(() => saveMapCameraPreference(blocked, 'parent-1', '3d'));
  });
});

describe('3D style decoration', () => {
  const vectorSource = { type: 'vector', url: 'https://tiles.openfreemap.org/planet' };
  const style = {
    version: 8,
    sources: { openmaptiles: vectorSource },
    layers: [
      {
        id: 'building-footprint',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
      },
      { id: 'labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ],
  };

  it('returns the exact original style in 2D', () => {
    assert.equal(mapStyleForDimension(style, '2d'), style);
  });

  it('adds sky and z15 extrusion using the existing vector source only', () => {
    const threeD = mapStyleForDimension(style, '3d') as {
      sources: typeof style.sources;
      sky: object;
      layers: Array<Record<string, unknown>>;
    };
    assert.equal(threeD.sources, style.sources, 'source table stays the same object');
    assert.deepEqual(Object.keys(threeD.sources), ['openmaptiles']);
    assert.ok(threeD.sky);
    const layer = threeD.layers.find((candidate) => candidate.id === MAP_BUILDING_LAYER_ID);
    assert.ok(layer);
    assert.equal(layer.type, 'fill-extrusion');
    assert.equal(layer.source, 'openmaptiles');
    assert.equal(layer['source-layer'], 'building');
    assert.equal(layer.minzoom, MAP_BUILDINGS_MIN_ZOOM);
    assert.ok(
      threeD.layers.findIndex((candidate) => candidate.id === MAP_BUILDING_LAYER_ID) <
        threeD.layers.findIndex((candidate) => candidate.id === 'labels'),
      'labels remain above the buildings',
    );
  });
});
