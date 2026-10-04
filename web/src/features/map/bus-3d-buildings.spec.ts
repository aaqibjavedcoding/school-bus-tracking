import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildingsLayerForDimension,
  buildingsLayerVisible,
} from './bus-3d.ts';
import { MAP_BUILDING_LAYER_ID, MAP_BUILDINGS_MIN_ZOOM } from '@school-bus-tracking/map-assets';

/**
 * Pins the "is the 3D buildings layer on?" decision (Session 6, step 1).
 * The rule is one line — buildings exist only in the 3D camera — but the
 * whole point of the session is that this rule is a pure exported function
 * with a spec, not a boolean buried in a component effect (`MapViewInner`'s
 * `applyMapDimension` calls these two functions and nothing else decides).
 */

const styleWithBuildings = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: { 'fill-color': '#e8eaed' },
    },
    { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
  ],
};

describe('buildingsLayerVisible — the only 3D-buildings decision', () => {
  it('is on in exactly one camera: the 3D one', () => {
    assert.equal(buildingsLayerVisible('3d'), true);
    assert.equal(buildingsLayerVisible('2d'), false);
  });

  it('treats a missing/unknown dimension as 2D (never shows volumes)', () => {
    assert.equal(buildingsLayerVisible(null), false);
    assert.equal(buildingsLayerVisible(undefined), false);
  });

  it('is a pure decision: same input, same answer, no hidden state', () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(buildingsLayerVisible('3d'), true);
      assert.equal(buildingsLayerVisible('2d'), false);
    }
  });
});

describe('buildingsLayerForDimension', () => {
  it('produces the tile-height-driven fill-extrusion in 3D, and nothing in 2D', () => {
    const layer = buildingsLayerForDimension(styleWithBuildings, '3d') as {
      id: string;
      type: string;
      source: string;
      'source-layer': string;
      minzoom: number;
      paint: Record<string, unknown>;
    };
    assert.equal(layer.id, MAP_BUILDING_LAYER_ID);
    assert.equal(layer.type, 'fill-extrusion');
    assert.equal(layer.source, 'openmaptiles', 'extrudes the EXISTING style source — no new tiles');
    assert.equal(layer['source-layer'], 'building');
    assert.equal(layer.minzoom, MAP_BUILDINGS_MIN_ZOOM);
    // The heights come from the vector tiles' own attributes (render_height
    // with a height fallback), not from any new data source or network call.
    assert.ok(JSON.stringify(layer.paint['fill-extrusion-height']).includes('render_height'));
    assert.ok(JSON.stringify(layer.paint['fill-extrusion-height']).includes('height'));

    assert.equal(buildingsLayerForDimension(styleWithBuildings, '2d'), null, '2D never gets the layer');
  });

  it('leaves the 2D map exactly as before: no layer, no style mutation', () => {
    const before = JSON.stringify(styleWithBuildings);
    buildingsLayerForDimension(styleWithBuildings, '2d');
    buildingsLayerForDimension(styleWithBuildings, '3d');
    assert.equal(JSON.stringify(styleWithBuildings), before, 'the source style is never mutated');
  });

  it('3D on a style without a vector building source degrades to no layer', () => {
    const styleWithoutSources = { version: 8, sources: {}, layers: [] };
    assert.equal(buildingsLayerForDimension(styleWithoutSources, '3d'), null);
  });
});
