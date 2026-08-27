import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { passwordSchema } from '@school-bus-tracking/validation';
import { comparePassword, hashPassword, normalizeEmail } from './password.util';

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
