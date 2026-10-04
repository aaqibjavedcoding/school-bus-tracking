import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUS_DOM_MARKER_LAYER_ID,
  POI_LAYER_ID,
  STOP_TAP_LAYER_IDS,
  humanisePoiClass,
  mapTapQueryLayerIds,
  poiInfoFromFeature,
  resolveMapTap,
  type TappedFeature,
} from './poi-sheet.ts';
import { BUS_3D_LAYER_ID } from './bus-3d.ts';

/**
 * Pins the POI tap sheet's precedence and content rules (Session 6, step 2):
 * stops/bus win absolutely, the sheet reads only the already-rendered tile
 * feature, and a tap on the plain base map dismisses.
 */

const poi = (properties: Record<string, unknown>): TappedFeature => ({
  layerId: POI_LAYER_ID,
  properties,
});
const school = () => poi({ name: 'Vidya Mandir', class: 'school' });
const temple = () => poi({ name: 'Shree Ganesh Mandir', class: 'place_of_worship' });

describe('humanisePoiClass', () => {
  it('turns OpenMapTiles classes into sentence-case category names', () => {
    assert.equal(humanisePoiClass('school'), 'School');
    assert.equal(humanisePoiClass('place_of_worship'), 'Place of worship');
    assert.equal(humanisePoiClass('fuel'), 'Fuel');
    assert.equal(humanisePoiClass('bus_stop'), 'Bus stop');
  });

  it('rejects anything that is not usable text', () => {
    assert.equal(humanisePoiClass(''), null);
    assert.equal(humanisePoiClass('   '), null);
    assert.equal(humanisePoiClass(null), null);
    assert.equal(humanisePoiClass(undefined), null);
    assert.equal(humanisePoiClass(42), null);
  });
});

describe('poiInfoFromFeature', () => {
  it('reads name and category from the rendered feature — nothing else', () => {
    assert.deepEqual(poiInfoFromFeature(school()), {
      name: 'Vidya Mandir',
      category: 'School',
      categoryRaw: 'school',
    });
  });

  it('falls back to name:en and tolerates a missing name entirely', () => {
    assert.deepEqual(poiInfoFromFeature(poi({ 'name:en': 'City Hospital', class: 'hospital' })), {
      name: 'City Hospital',
      category: 'Hospital',
      categoryRaw: 'hospital',
    });
    const unnamed = poiInfoFromFeature(poi({ class: 'park' }));
    assert.equal(unnamed?.name, null);
    assert.equal(unnamed?.category, 'Park');
  });

  it('refuses a feature without a class: no guesswork, no empty sheet', () => {
    assert.equal(poiInfoFromFeature(poi({ name: 'Mystery Pin' })), null);
    assert.equal(poiInfoFromFeature({ layerId: POI_LAYER_ID }), null);
    assert.equal(poiInfoFromFeature(poi({ name: '', class: '  ' })), null);
  });
});

describe('resolveMapTap — stop markers WIN', () => {
  it('a stop anywhere in the hit list beats every POI (order-independent)', () => {
    for (const stopLayer of STOP_TAP_LAYER_IDS) {
      // Stop rendered under the POI (typical: dot below an icon layer).
      assert.deepEqual(resolveMapTap([school(), { layerId: stopLayer }]), { type: 'app-feature' });
      // Stop rendered on top of the POI.
      assert.deepEqual(resolveMapTap([{ layerId: stopLayer }, school()]), { type: 'app-feature' });
    }
  });

  it('the bus wins too — the 3D mesh layer and the flat 2D DOM marker alike', () => {
    assert.deepEqual(resolveMapTap([school(), { layerId: BUS_3D_LAYER_ID }]), {
      type: 'app-feature',
    });
    assert.deepEqual(resolveMapTap([school(), { layerId: BUS_DOM_MARKER_LAYER_ID }]), {
      type: 'app-feature',
    });
    assert.deepEqual(resolveMapTap([{ layerId: BUS_DOM_MARKER_LAYER_ID }, temple()]), {
      type: 'app-feature',
    });
  });

  it('opens the sheet on the first usable POI when no app feature was hit', () => {
    const outcome = resolveMapTap([{ layerId: 'building' }, school(), temple()]);
    assert.equal(outcome.type, 'poi');
    assert.equal(outcome.type === 'poi' && outcome.poi.name, 'Vidya Mandir');
    assert.equal(outcome.type === 'poi' && outcome.poi.category, 'School');
  });

  it('skips unusable POI features and takes the first usable one', () => {
    const outcome = resolveMapTap([poi({ name: 'No class here' }), temple()]);
    assert.equal(outcome.type, 'poi');
    assert.equal(outcome.type === 'poi' && outcome.poi.category, 'Place of worship');
  });

  it('plain base map (or POI-less taps) means empty: dismiss', () => {
    assert.deepEqual(resolveMapTap([]), { type: 'empty' });
    assert.deepEqual(resolveMapTap([{ layerId: 'building' }, { layerId: 'water' }]), {
      type: 'empty',
    });
    // A POI layer hit the sheet cannot use is still a dismiss, not a blank sheet.
    assert.deepEqual(resolveMapTap([poi({ name: '' })]), { type: 'empty' });
  });
});

describe('mapTapQueryLayerIds', () => {
  it('queries exactly the stop layers, the 3D bus and the POI layer', () => {
    const ids = mapTapQueryLayerIds();
    assert.deepEqual(ids, [...STOP_TAP_LAYER_IDS, BUS_3D_LAYER_ID, POI_LAYER_ID]);
    // The flat 2D marker is DOM and can never be queried — it arrives as the
    // synthetic id instead, deliberately absent from this list.
    assert.ok(!ids.includes(BUS_DOM_MARKER_LAYER_ID));
  });
});
