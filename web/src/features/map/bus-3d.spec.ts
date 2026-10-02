import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUS_3D_LAYER_ID,
  BUS_3D_SOURCE_ID,
  BUS_MAX_LENGTH_METERS,
  BUS_REAL_LENGTH_METERS,
  busExtrusionLayer,
  busLengthMeters,
  busMeshCollection,
  busParts,
  metersPerPixel,
} from './bus-3d.ts';

const FIX = { latitude: 28.6139, longitude: 77.209 };

function bbox(collection: ReturnType<typeof busMeshCollection>) {
  assert.ok(collection);
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const feature of collection.features) {
    for (const [lng, lat] of feature.geometry.coordinates[0]) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return { minLng, maxLng, minLat, maxLat };
}

test('metersPerPixel shrinks with zoom and with latitude', () => {
  assert.ok(metersPerPixel(0, 16) > metersPerPixel(0, 17));
  assert.ok(metersPerPixel(60, 16) < metersPerPixel(0, 16));
});

test('the drawn bus is never smaller than a real bus, never a city block', () => {
  for (const zoom of [8, 11, 13, 15, 16, 17, 18, 20, 22]) {
    const length = busLengthMeters(FIX.latitude, zoom);
    assert.ok(length >= BUS_REAL_LENGTH_METERS, `z${zoom} too small: ${length}`);
    assert.ok(length <= BUS_MAX_LENGTH_METERS, `z${zoom} too big: ${length}`);
  }
  // Pulling the camera back grows the ground footprint, which is what keeps
  // the vehicle a readable size on screen (the ride-hailing marker idiom).
  assert.ok(busLengthMeters(FIX.latitude, 14) > busLengthMeters(FIX.latitude, 18));
});

test('the mesh is a solid stack of parts: wheels on the ground, roof on top', () => {
  const parts = busParts(12);
  const ids = parts.map((part) => part.id);
  assert.ok(ids.filter((id) => id.startsWith('wheel-')).length === 4, 'four wheels');
  assert.ok(ids.includes('body'));
  assert.ok(ids.includes('windows'));
  assert.ok(ids.includes('roof'));

  const wheel = parts.find((part) => part.id === 'wheel-0');
  assert.equal(wheel?.base, 0, 'wheels touch the road');
  const roof = parts.find((part) => part.id === 'roof');
  const body = parts.find((part) => part.id === 'body');
  assert.ok(roof && body && roof.height > body.height, 'the roof is the top of the volume');
  for (const part of parts) {
    assert.ok(part.height > part.base, `${part.id} must have real depth`);
    assert.ok(part.points.length >= 4, `${part.id} must be a polygon`);
  }
});

test('every part is anchored on the real GPS coordinate', () => {
  const mesh = busMeshCollection({ ...FIX, headingDeg: 0, zoom: 17 });
  assert.ok(mesh);
  const box = bbox(mesh);
  // The GPS point is the centre of the drawing, within a centimetre.
  assert.ok(Math.abs((box.minLat + box.maxLat) / 2 - FIX.latitude) < 1e-6);
  assert.ok(Math.abs((box.minLng + box.maxLng) / 2 - FIX.longitude) < 1e-6);
  // Rings are closed (MapLibre requires it for a filled polygon).
  for (const feature of mesh.features) {
    const ring = feature.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  }
});

test('heading 0 points the bus north, heading 90 points it east', () => {
  const north = bbox(busMeshCollection({ ...FIX, headingDeg: 0, zoom: 17 }));
  const east = bbox(busMeshCollection({ ...FIX, headingDeg: 90, zoom: 17 }));
  const northSpanLat = north.maxLat - north.minLat;
  const northSpanLng = north.maxLng - north.minLng;
  const eastSpanLat = east.maxLat - east.minLat;
  const eastSpanLng = east.maxLng - east.minLng;
  assert.ok(northSpanLat > northSpanLng, 'nose-north: the bus is longer north-south');
  assert.ok(eastSpanLng > eastSpanLat, 'nose-east: the bus is longer east-west');
});

test('the nose moves with the heading rather than the whole bus jumping', () => {
  const noseOf = (headingDeg: number) => {
    const mesh = busMeshCollection({ ...FIX, headingDeg, zoom: 17 });
    assert.ok(mesh);
    const bumper = mesh.features.find((f) => f.properties?.part === 'bumper-front');
    assert.ok(bumper);
    const ring = bumper.geometry.coordinates[0];
    const lng = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
    const lat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
    return { lng, lat };
  };
  assert.ok(noseOf(0).lat > FIX.latitude, 'north heading puts the nose north of the fix');
  assert.ok(noseOf(180).lat < FIX.latitude, 'south heading puts the nose south of the fix');
  assert.ok(noseOf(90).lng > FIX.longitude, 'east heading puts the nose east of the fix');
  assert.ok(noseOf(270).lng < FIX.longitude, 'west heading puts the nose west of the fix');
});

test('a null heading is drawn nose-north instead of disappearing', () => {
  const mesh = busMeshCollection({ ...FIX, headingDeg: null, zoom: 17 });
  assert.ok(mesh);
  assert.ok(mesh.features.length > 0);
});

test('nothing is produced for a missing or non-finite position', () => {
  assert.equal(busMeshCollection(null), null);
  assert.equal(busMeshCollection({ latitude: NaN, longitude: 1, headingDeg: 0, zoom: 16 }), null);
  assert.equal(
    busMeshCollection({ latitude: 1, longitude: 1, headingDeg: 0, zoom: Number.NaN }),
    null,
  );
});

test('the vehicle is opaque — opacity is not how this layer is tuned', () => {
  const layer = busExtrusionLayer() as {
    id: string;
    type: string;
    source: string;
    paint: Record<string, unknown>;
  };
  assert.equal(layer.id, BUS_3D_LAYER_ID);
  assert.equal(layer.source, BUS_3D_SOURCE_ID);
  assert.equal(layer.type, 'fill-extrusion', 'real extruded geometry, not an icon');
  assert.equal(layer.paint['fill-extrusion-opacity'], 1);
  assert.equal(layer.paint['fill-extrusion-vertical-gradient'], true);
});

test('a stale fix is recoloured, never made transparent', () => {
  const live = busParts(12, false).find((part) => part.id === 'body');
  const stale = busParts(12, true).find((part) => part.id === 'body');
  assert.notEqual(live?.color, stale?.color);
  assert.ok(stale?.color.startsWith('#'), 'flat opaque colour, no alpha channel');
});
