import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '../../../framework';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StoreRouteGeometryDto } from './store-route-geometry.dto';

/**
 * `PUT /api/v1/routes/:id/geometry` body validation.
 *
 * The body is a piece of map data every driver, conductor and parent will
 * later be shown as "the road the bus takes", so the DTO is deliberately
 * strict: a usable LineString (>= 2 positions, every position a finite
 * in-range [longitude, latitude] pair), finite non-negative totals, and
 * structurally valid legs/maneuvers. NaN/Infinity are rejected by
 * `@IsNumber` by default; JSON cannot carry them, so a hostile client can
 * only send `null`/strings — which fail the same check.
 */

const VALID_BODY = {
  status: 'road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [73.0479, 33.6844],
      [73.0551, 33.6901],
      [73.0613, 33.6972],
    ],
  },
  distance_meters: 4820.5,
  duration_seconds: 612.3,
  legs: [
    {
      distance_meters: 2410.2,
      duration_seconds: 300.1,
      maneuvers: [
        {
          type: 'depart',
          modifier: null,
          road_name: 'Margalla Road',
          distance_meters: 120.4,
          location: [73.0479, 33.6844],
        },
        {
          type: 'turn',
          modifier: 'left',
          road_name: '7th Avenue',
          distance_meters: 2289.8,
          location: [73.0551, 33.6901],
        },
      ],
    },
    {
      distance_meters: 2410.3,
      duration_seconds: 312.2,
      maneuvers: [
        {
          type: 'arrive',
          modifier: null,
          road_name: '',
          distance_meters: 2410.3,
          location: [73.0613, 33.6972],
        },
      ],
    },
  ],
  provider: 'osrm',
  computed_at: '2026-10-03T08:30:00.000Z',
};

async function validateBody(body: Record<string, unknown>) {
  return validate(plainToInstance(StoreRouteGeometryDto, body));
}

/**
 * Root properties that failed validation (sorted, for stable assertions).
 * Nested failures (a bad coordinate inside `geometry`, a bad maneuver inside
 * `legs`) surface as children of the root error, so asserting on the roots
 * keeps the expectations readable: a geometry problem is `['geometry']`, a
 * legs problem is `['legs']`.
 */
async function failingProperties(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validateBody(body);
  return errors.map((error) => error.property).sort();
}

describe('StoreRouteGeometryDto validation', () => {
  it('accepts a well-formed engine result', async () => {
    assert.equal((await validateBody(VALID_BODY)).length, 0);
  });

  it('accepts an omitted computed_at and an empty legs list', async () => {
    const { computed_at: _omitted, ...withoutTimestamp } = VALID_BODY;
    assert.equal((await validateBody(withoutTimestamp)).length, 0);
    assert.equal((await validateBody({ ...VALID_BODY, legs: [] })).length, 0);
  });

  it('requires status "road" and rejects anything else', async () => {
    assert.deepEqual(await failingProperties({ ...VALID_BODY, status: 'flight' }), ['status']);
    const { status: _omitted, ...withoutStatus } = VALID_BODY;
    assert.deepEqual(await failingProperties(withoutStatus), ['status']);
  });

  it('rejects a geometry that is not a LineString', async () => {
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        geometry: { type: 'Point', coordinates: [[73.0479, 33.6844]] },
      }),
      ['geometry'],
    );
  });

  it('rejects a LineString with fewer than two positions', async () => {
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        geometry: { type: 'LineString', coordinates: [[73.0479, 33.6844]] },
      }),
      ['geometry'],
    );
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        geometry: { type: 'LineString', coordinates: [] },
      }),
      ['geometry'],
    );
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        geometry: { type: 'LineString', coordinates: 'not-a-list' },
      }),
      ['geometry'],
    );
  });

  it('rejects a bad coordinate (out of range, NaN, non-number, wrong arity)', async () => {
    const badCoordinates = [
      [
        [73.0479, 91.0],
        [73.0551, 33.6901],
      ], // latitude out of range
      [
        [-181.0, 33.6844],
        [73.0551, 33.6901],
      ], // longitude out of range
      [
        [Number.NaN, 33.6844],
        [73.0551, 33.6901],
      ], // NaN longitude
      [
        [73.0479, Number.POSITIVE_INFINITY],
        [73.0551, 33.6901],
      ], // Infinity latitude
      [
        ['73.0479', 33.6844],
        [73.0551, 33.6901],
      ], // string longitude
      [
        [73.0479, 33.6844, 12.5],
        [73.0551, 33.6901],
      ], // 3-tuple (altitude not accepted)
      [[73.0479], [73.0551, 33.6901]], // 1-tuple
    ];
    for (const coordinates of badCoordinates) {
      assert.deepEqual(
        await failingProperties({
          ...VALID_BODY,
          geometry: { type: 'LineString', coordinates },
        }),
        ['geometry'],
        `expected rejection for ${JSON.stringify(coordinates)}`,
      );
    }
  });

  it('rejects NaN / Infinity / negative / non-numeric totals', async () => {
    const badTotals: Array<[string, unknown]> = [
      ['distance_meters', Number.NaN],
      ['distance_meters', Number.POSITIVE_INFINITY],
      ['distance_meters', -1],
      ['distance_meters', '4820.5'],
      ['distance_meters', null],
      ['duration_seconds', Number.NaN],
      ['duration_seconds', -0.5],
      ['duration_seconds', '612.3'],
    ];
    for (const [field, value] of badTotals) {
      assert.deepEqual(
        await failingProperties({ ...VALID_BODY, [field]: value }),
        [field],
        `expected rejection for ${field}=${String(value)}`,
      );
    }
  });

  it('rejects structurally invalid legs and maneuvers', async () => {
    // Leg with a negative distance.
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        legs: [{ distance_meters: -1, duration_seconds: 10, maneuvers: [] }],
      }),
      ['legs'],
    );
    // Maneuver with a bad location.
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        legs: [
          {
            distance_meters: 1,
            duration_seconds: 1,
            maneuvers: [
              {
                type: 'turn',
                modifier: null,
                road_name: '',
                distance_meters: 1,
                location: [200, 0],
              },
            ],
          },
        ],
      }),
      ['legs'],
    );
    // Maneuver without a type.
    assert.deepEqual(
      await failingProperties({
        ...VALID_BODY,
        legs: [
          {
            distance_meters: 1,
            duration_seconds: 1,
            maneuvers: [
              { modifier: null, road_name: '', distance_meters: 1, location: [73.0, 33.0] },
            ],
          },
        ],
      }),
      ['legs'],
    );
    // Legs not a list.
    assert.deepEqual(await failingProperties({ ...VALID_BODY, legs: {} }), ['legs']);
  });

  it('rejects a missing or over-long provider', async () => {
    const { provider: _omitted, ...withoutProvider } = VALID_BODY;
    assert.deepEqual(await failingProperties(withoutProvider), ['provider']);
    assert.deepEqual(await failingProperties({ ...VALID_BODY, provider: 'x'.repeat(33) }), [
      'provider',
    ]);
  });

  it('rejects a malformed computed_at', async () => {
    assert.deepEqual(await failingProperties({ ...VALID_BODY, computed_at: 'yesterday' }), [
      'computed_at',
    ]);
  });

  it('rejects client-supplied school_id / stops_hash through the global pipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    for (const extra of [
      { school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { stops_hash: 'a'.repeat(64) },
    ]) {
      await assert.rejects(
        pipe.transform(
          { ...VALID_BODY, ...extra },
          { metatype: StoreRouteGeometryDto, type: 'body' },
        ),
        (error: { getStatus?: () => number }) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus?.(), 400);
          return true;
        },
      );
    }
  });
});
