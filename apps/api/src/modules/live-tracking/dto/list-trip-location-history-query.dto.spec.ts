import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { tripLocationHistoryQuerySchema } from '@school-bus-tracking/validation';
import { ListTripLocationHistoryQueryDto } from './list-trip-location-history-query.dto';

async function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(ListTripLocationHistoryQueryDto, body));
}

describe('ListTripLocationHistoryQueryDto validation', () => {
  it('accepts an empty query and a full window', async () => {
    assert.equal((await errorsFor({})).length, 0);
    assert.equal(
      (
        await errorsFor({
          from: '2026-09-01T06:00:00.000Z',
          to: '2026-09-01T09:00:00.000Z',
          limit: 250,
        })
      ).length,
      0,
    );
  });

  it('rejects non-integer limits and limits outside 1..500', async () => {
    for (const limit of ['ten', 1.5, 0, 501, -4]) {
      const errors = await errorsFor({ limit });
      assert.ok(
        errors.some((error) => error.property === 'limit'),
        `limit=${String(limit)}`,
      );
    }
  });

  it('rejects non-string from/to', async () => {
    for (const [field, value] of [
      ['from', 1727768400000],
      ['to', true],
    ] as Array<[string, unknown]>) {
      const errors = await errorsFor({ [field]: value });
      assert.ok(
        errors.some((error) => error.property === field),
        `${field}=${String(value)}`,
      );
    }
  });

  it('rejects unknown query parameters (forbidNonWhitelisted)', async () => {
    // Same pipe configuration as `main.ts`: unknown properties are rejected,
    // never silently stripped.
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    const forbidden: Array<[string, unknown]> = [
      ['school_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      ['trip_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      ['latitude', 51.5],
      ['recorded_at', '2026-09-01T06:31:00.000Z'],
      ['direction', 'ASC'],
    ];

    for (const [field, value] of forbidden) {
      await assert.rejects(
        pipe.transform(
          { [field]: value },
          { metatype: ListTripLocationHistoryQueryDto, type: 'query' },
        ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          return true;
        },
      );
    }

    const accepted = await pipe.transform(
      { from: '2026-09-01T06:00:00.000Z', limit: 10 },
      { metatype: ListTripLocationHistoryQueryDto, type: 'query' },
    );
    assert.equal(accepted.from, '2026-09-01T06:00:00.000Z');
    assert.equal(accepted.limit, 10);
  });
});

describe('history query Zod schema (service-level revalidation)', () => {
  it('parses valid windows and leaves the limit to the service default', () => {
    const parsed = tripLocationHistoryQuerySchema.safeParse({
      from: '2026-09-01T06:00:00.000Z',
      to: '2026-09-01T09:00:00.000Z',
      limit: 500,
    });
    assert.equal(parsed.success, true);

    // The schema stays a pure validator; the service applies
    // `DEFAULT_HISTORY_LIMIT` (100) when the client sends no limit.
    const empty = tripLocationHistoryQuerySchema.safeParse({});
    assert.equal(empty.success, true);
    assert.equal(empty.success && empty.data.limit, undefined);
  });

  it('rejects malformed timestamps, inverted windows and out-of-range limits', () => {
    const cases: Array<Record<string, unknown>> = [
      { from: 'not-a-date' },
      { from: '2026-09-01T09:00:00.000Z', to: '2026-09-01T06:00:00.000Z' },
      { limit: 0 },
      { limit: 501 },
      { limit: '50' },
    ];

    for (const input of cases) {
      const result = tripLocationHistoryQuerySchema.safeParse(input);
      assert.equal(result.success, false, JSON.stringify(input));
    }
  });

  it('is strict about unexpected keys', () => {
    const result = tripLocationHistoryQuerySchema.safeParse({
      from: '2026-09-01T06:00:00.000Z',
      direction: 'asc',
    });
    assert.equal(result.success, false);
  });
});
