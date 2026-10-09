import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '../../../framework';
import {
  isInsideBbox,
  ListMissingRouteGeometryQueryDto,
  parseBoundingBox,
} from './list-missing-route-geometry-query.dto';

/**
 * `GET /api/v1/admin/routes/geometry/missing` query DTO.
 *
 * Pagination is the same as every other list endpoint. The optional `bbox`
 * is the OSM extract's box in OSRM order: `minLon,minLat,maxLon,maxLat`. A
 * malformed box is 400 — class-validator pins the wire shape, this DTO pins
 * the ranges and the strict `min < max` ordering.
 */

async function validateQuery(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(ListMissingRouteGeometryQueryDto, body));
  return errors.map((error) => error.property).sort();
}

describe('ListMissingRouteGeometryQueryDto — pagination', () => {
  it('applies the documented defaults (page 1, limit 20)', () => {
    const dto = plainToInstance(ListMissingRouteGeometryQueryDto, {});
    assert.equal(dto.page, 1);
    assert.equal(dto.limit, 20);
  });

  it('rejects a page below 1 and a limit above 100', async () => {
    assert.deepEqual(await validateQuery({ page: 0 }), ['page']);
    assert.deepEqual(await validateQuery({ limit: 500 }), ['limit']);
    assert.deepEqual(await validateQuery({ page: 1.5 }), ['page']);
  });

  it('accepts a query without a bbox', async () => {
    assert.equal((await validateQuery({ page: 2, limit: 50 })).length, 0);
  });
});

describe('ListMissingRouteGeometryQueryDto — bbox shape', () => {
  it('accepts a well-formed four-tuple', async () => {
    assert.equal((await validateQuery({ bbox: '72.0,32.0,75.0,35.0' })).length, 0);
  });

  it('rejects three or five numbers, scientific notation, and any whitespace', async () => {
    assert.deepEqual(await validateQuery({ bbox: '72.0,32.0,75.0' }), ['bbox']);
    assert.deepEqual(await validateQuery({ bbox: '72.0,32.0,75.0,35.0,40.0' }), ['bbox']);
    assert.deepEqual(await validateQuery({ bbox: '7.2e1,32.0,75.0,35.0' }), ['bbox']);
    assert.deepEqual(await validateQuery({ bbox: ' 72.0,32.0,75.0,35.0' }), ['bbox']);
  });
});

describe('parseBoundingBox — range and ordering', () => {
  it('parses a well-formed box to a typed handle', () => {
    const box = parseBoundingBox('72.0,32.0,75.0,35.0');
    assert.deepEqual(box, { minLon: 72, minLat: 32, maxLon: 75, maxLat: 35 });
  });

  it('rejects non-finite numbers, 400', () => {
    assert.throws(() => parseBoundingBox('NaN,32.0,75.0,35.0'), BadRequestException);
    assert.throws(() => parseBoundingBox('Infinity,32.0,75.0,35.0'), BadRequestException);
  });

  it('rejects longitudes outside [-180, 180] and latitudes outside [-90, 90]', () => {
    assert.throws(
      () => parseBoundingBox('-181,0,75,35'),
      (error: Error) => {
        assert.match(error.message, /longitudes must lie in/);
        return true;
      },
    );
    assert.throws(
      () => parseBoundingBox('0,-91,75,35'),
      (error: Error) => {
        assert.match(error.message, /latitudes must lie in/);
        return true;
      },
    );
  });

  it('rejects min >= max on either axis (a 4-tuple with empty area), 400', () => {
    assert.throws(
      () => parseBoundingBox('75,0,75,35'),
      (error: Error) => {
        assert.match(error.message, /minLon must be strictly less than maxLon/);
        return true;
      },
    );
    assert.throws(
      () => parseBoundingBox('0,35,75,35'),
      (error: Error) => {
        assert.match(error.message, /minLat must be strictly less than maxLat/);
        return true;
      },
    );
  });

  it('accepts the boundary values exactly (a box edge is inclusive)', () => {
    // The boundary itself is legal: a stop ON the box edge is "inside".
    parseBoundingBox('-180,-90,180,90');
    parseBoundingBox('0,0,0.0001,0.0001');
  });
});

describe('isInsideBbox — inclusive on every edge', () => {
  const box = parseBoundingBox('72.0,32.0,75.0,35.0');

  it('a point strictly inside the box is inside', () => {
    assert.equal(isInsideBbox(box, 73.5, 33.5), true);
  });

  it('a point on the box edge is inside (inclusive)', () => {
    assert.equal(isInsideBbox(box, 72, 33), true);
    assert.equal(isInsideBbox(box, 75, 32), true);
  });

  it('a point outside the box is outside', () => {
    assert.equal(isInsideBbox(box, 71.9, 33), false);
    assert.equal(isInsideBbox(box, 73, 35.1), false);
  });
});
