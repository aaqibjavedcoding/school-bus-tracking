import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashToken,
  parseCookieHeader,
  parseDurationToMs,
} from './token.util';

describe('generateRefreshToken', () => {
  it('generates a 64-character hexadecimal string', () => {
    const token = generateRefreshToken();
    assert.equal(typeof token, 'string');
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it('generates unique tokens on subsequent calls', () => {
    const tokenA = generateRefreshToken();
    const tokenB = generateRefreshToken();
    assert.notEqual(tokenA, tokenB);
  });
});

describe('hashToken', () => {
  it('computes a consistent 64-character SHA-256 hex digest', () => {
    const token = 'sample-random-token-value-12345';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 64);
    assert.match(hash1, /^[0-9a-f]{64}$/);
    assert.equal(hash1, hash2);
  });

  it('produces different hashes for different tokens', () => {
    const hash1 = hashToken('token-one');
    const hash2 = hashToken('token-two');
    assert.notEqual(hash1, hash2);
  });

  it('never returns the raw token', () => {
    const token = 'sensitive-token-data';
    const hash = hashToken(token);
    assert.notEqual(hash, token);
    assert.ok(!hash.includes(token));
  });
});

describe('parseDurationToMs', () => {
  it('parses second-based durations', () => {
    assert.equal(parseDurationToMs('30s'), 30 * 1000);
    assert.equal(parseDurationToMs('60s'), 60 * 1000);
  });

  it('parses minute-based durations', () => {
    assert.equal(parseDurationToMs('15m'), 15 * 60 * 1000);
    assert.equal(parseDurationToMs('30m'), 30 * 60 * 1000);
  });

  it('parses hour-based durations', () => {
    assert.equal(parseDurationToMs('1h'), 60 * 60 * 1000);
    assert.equal(parseDurationToMs('24h'), 24 * 60 * 60 * 1000);
  });

  it('parses day-based durations', () => {
    assert.equal(parseDurationToMs('1d'), 24 * 60 * 60 * 1000);
    assert.equal(parseDurationToMs('7d'), 7 * 24 * 60 * 60 * 1000);
    assert.equal(parseDurationToMs('30d'), 30 * 24 * 60 * 60 * 1000);
  });

  it('parses week-based durations', () => {
    assert.equal(parseDurationToMs('1w'), 7 * 24 * 60 * 60 * 1000);
    assert.equal(parseDurationToMs('2w'), 14 * 24 * 60 * 60 * 1000);
  });

  it('parses numeric values as seconds', () => {
    assert.equal(parseDurationToMs(3600), 3600 * 1000);
  });

  it('falls back to default for invalid or empty inputs', () => {
    assert.equal(parseDurationToMs(undefined), DEFAULT_REFRESH_TOKEN_TTL_MS);
    assert.equal(parseDurationToMs(''), DEFAULT_REFRESH_TOKEN_TTL_MS);
    assert.equal(parseDurationToMs('invalid-unit'), DEFAULT_REFRESH_TOKEN_TTL_MS);
    assert.equal(parseDurationToMs(-10), DEFAULT_REFRESH_TOKEN_TTL_MS);
  });
});

describe('parseCookieHeader', () => {
  it('extracts key-value pairs from cookie header', () => {
    const cookies = parseCookieHeader('refresh_token=abc123xyz; session=foo; other=bar');
    assert.equal(cookies['refresh_token'], 'abc123xyz');
    assert.equal(cookies['session'], 'foo');
    assert.equal(cookies['other'], 'bar');
  });

  it('handles url-encoded cookie values', () => {
    const cookies = parseCookieHeader('my_cookie=hello%20world');
    assert.equal(cookies['my_cookie'], 'hello world');
  });

  it('returns empty object for empty or missing header', () => {
    assert.deepEqual(parseCookieHeader(undefined), {});
    assert.deepEqual(parseCookieHeader(''), {});
  });
});
