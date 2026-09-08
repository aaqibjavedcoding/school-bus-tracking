import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateIdempotencyKey, IDEMPOTENCY_HEADER } from './idempotency.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateIdempotencyKey', () => {
  it('targets the header the API deduplicates on', () => {
    assert.equal(IDEMPOTENCY_HEADER, 'x-idempotency-key');
  });

  it('returns a UUID v4', () => {
    assert.match(generateIdempotencyKey(), UUID_PATTERN);
  });

  it('returns a fresh key per call', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateIdempotencyKey()));
    assert.equal(keys.size, 100);
  });
});
