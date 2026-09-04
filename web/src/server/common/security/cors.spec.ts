import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CORS_NOT_CONFIGURED_MESSAGE,
  CORS_WILDCARD_REJECTED_MESSAGE,
  buildCorsOptions,
  isOriginAllowed,
  resolveCorsPolicy,
} from './cors';
import { parseOriginList } from '../../config';

const WEB = 'https://app.school.example';
const ADMIN = 'https://admin.school.example';
const EVIL = 'https://evil.example';

describe('parseOriginList', () => {
  it('splits, trims and drops empty entries', () => {
    assert.deepEqual(parseOriginList(` ${WEB} , ${ADMIN} ,, `), [WEB, ADMIN]);
    assert.deepEqual(parseOriginList(undefined), []);
    assert.deepEqual(parseOriginList(''), []);
  });
});

describe('resolveCorsPolicy (production)', () => {
  it('rejects a wildcard origin', () => {
    assert.throws(
      () => resolveCorsPolicy({ isProduction: true, corsOrigins: ['*'], credentials: true }),
      (error: Error) => {
        assert.equal(error.message, CORS_WILDCARD_REJECTED_MESSAGE);
        return true;
      },
    );
  });

  it('rejects a wildcard mixed into an allowlist', () => {
    assert.throws(
      () => resolveCorsPolicy({ isProduction: true, corsOrigins: [WEB, '*'], credentials: true }),
      /not allowed in production/,
    );
  });

  it('fails fast when no origin is configured', () => {
    assert.throws(
      () => resolveCorsPolicy({ isProduction: true, corsOrigins: [], credentials: true }),
      (error: Error) => {
        assert.equal(error.message, CORS_NOT_CONFIGURED_MESSAGE);
        return true;
      },
    );
  });

  it('accepts an explicit allowlist and keeps credentials on', () => {
    const policy = resolveCorsPolicy({
      isProduction: true,
      corsOrigins: [WEB, ADMIN],
      credentials: true,
    });
    assert.deepEqual(policy, { origins: [WEB, ADMIN], allowAll: false, credentials: true });
  });
});

describe('resolveCorsPolicy (development)', () => {
  it('defaults to the local web origin when unset', () => {
    const policy = resolveCorsPolicy({ isProduction: false, corsOrigins: [], credentials: true });
    assert.deepEqual(policy.origins, ['http://localhost:3000']);
    assert.equal(policy.allowAll, false);
  });

  it('honours an explicit wildcard but disables credentials (Fetch spec)', () => {
    const policy = resolveCorsPolicy({ isProduction: false, corsOrigins: ['*'], credentials: true });
    assert.equal(policy.allowAll, true);
    assert.equal(policy.credentials, false);
  });
});

describe('isOriginAllowed', () => {
  const policy = resolveCorsPolicy({
    isProduction: true,
    corsOrigins: [WEB],
    credentials: true,
  });

  it('allows an allowlisted browser origin', () => {
    assert.equal(isOriginAllowed(policy, WEB), true);
  });

  it('rejects an unknown origin', () => {
    assert.equal(isOriginAllowed(policy, EVIL), false);
  });

  it('allows requests without an Origin header (mobile / server clients)', () => {
    assert.equal(isOriginAllowed(policy, undefined), true);
    assert.equal(isOriginAllowed(policy, null), true);
  });

  it('allows everything when a wildcard policy is in effect', () => {
    const wildcard = resolveCorsPolicy({
      isProduction: false,
      corsOrigins: ['*'],
      credentials: true,
    });
    assert.equal(isOriginAllowed(wildcard, EVIL), true);
  });
});

describe('buildCorsOptions', () => {
  const policy = resolveCorsPolicy({ isProduction: true, corsOrigins: [WEB], credentials: true });
  const options = buildCorsOptions(policy);

  it('answers the origin callback without throwing', () => {
    const results: Array<boolean | undefined> = [];
    options.origin(WEB, (error, allow) => {
      assert.equal(error, null);
      results.push(allow);
    });
    options.origin(EVIL, (error, allow) => {
      assert.equal(error, null);
      results.push(allow);
    });
    assert.deepEqual(results, [true, false]);
  });

  it('allows the CSRF header and exposes the rate-limit headers', () => {
    assert.ok(options.allowedHeaders.includes('X-CSRF-Token'));
    assert.ok(options.exposedHeaders.includes('Retry-After'));
    assert.equal(options.credentials, true);
  });
});
