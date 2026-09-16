import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { passwordSchema } from '@school-bus-tracking/validation';
import * as bcrypt from 'bcryptjs';
import {
  HASH_PREFIX,
  isOwnPasswordHash,
  comparePassword,
  hashPassword,
  normalizeEmail,
} from './password.util';

describe('password hashing', () => {
  it('hashes a password to a value that is not the plaintext', async () => {
    const plaintext = 'correct-horse-battery';
    const hash = await hashPassword(plaintext);
    assert.equal(typeof hash, 'string');
    assert.notEqual(hash, plaintext);
    assert.match(hash, /^\$2[aby]?\$\d{2}\$/);
  });

  it('compares the correct password as true', async () => {
    const plaintext = 'correct-horse-battery';
    const hash = await hashPassword(plaintext);
    assert.equal(await comparePassword(plaintext, hash), true);
  });

  it('compares an incorrect password as false', async () => {
    const hash = await hashPassword('correct-horse-battery');
    assert.equal(await comparePassword('wrong-password-value', hash), false);
  });

  it('mints a 60-character `$2b$12$` digest carrying the `$` field separator', async () => {
    const hash = await hashPassword('correct-horse-battery');
    assert.equal(hash.length, 60);
    assert.equal(hash.startsWith(HASH_PREFIX), true);
    // The marker: salt (22) + `$` + checksum (30), at a position bcrypt's own
    // base64 alphabet can never produce.
    assert.equal(hash.charAt(HASH_PREFIX.length + 22), '$');
    assert.equal(isOwnPasswordHash(hash), true);
  });

  it('recognises no real bcrypt digest as its own format', async () => {
    for (const cost of [4, 10, 12]) {
      const legacy = await bcrypt.hash('legacy-password', cost);
      assert.equal(isOwnPasswordHash(legacy), false, `bcrypt cost ${cost} misclassified`);
    }
  });

  it('still verifies legacy bcrypt digests (no migration window)', async () => {
    // A real bcrypt-12 row is exactly the shape a pre-existing user column
    // holds; it must route to the bcrypt fallback and keep verifying.
    const legacy = await bcrypt.hash('legacy-password', 12);
    assert.equal(isOwnPasswordHash(legacy), false);
    assert.equal(await comparePassword('legacy-password', legacy), true);
    assert.equal(await comparePassword('not-the-password', legacy), false);
  });
});

describe('password validation', () => {
  it('accepts a reasonable password', () => {
    const result = passwordSchema.safeParse('longenough');
    assert.equal(result.success, true);
  });

  it('rejects an empty password', () => {
    const result = passwordSchema.safeParse('');
    assert.equal(result.success, false);
  });

  it('rejects a whitespace-only password', () => {
    const result = passwordSchema.safeParse('        ');
    assert.equal(result.success, false);
  });

  it('rejects a password shorter than the minimum length', () => {
    const result = passwordSchema.safeParse('short');
    assert.equal(result.success, false);
  });
});

describe('email normalization', () => {
  it('trims and lowercases consistently', () => {
    assert.equal(normalizeEmail('  Admin@Demo-School.TEST  '), 'admin@demo-school.test');
    assert.equal(normalizeEmail('admin@demo-school.test'), 'admin@demo-school.test');
  });
});
