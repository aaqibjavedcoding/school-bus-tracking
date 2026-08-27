import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from './login.dto';

const VALID_BODY = {
  school_id: '11111111-1111-4111-8111-111111111111',
  email: 'driver@school.org',
  password: 'correct-horse-battery',
};

async function validateBody(body: Record<string, unknown>) {
  return validate(plainToInstance(LoginDto, body));
}

function properties(errors: Awaited<ReturnType<typeof validateBody>>): string[] {
  return errors.map((error) => error.property).sort();
}

describe('LoginDto validation', () => {
  it('accepts a well-formed body', async () => {
    const errors = await validateBody(VALID_BODY);
    assert.equal(errors.length, 0);
  });

  it('rejects a missing or malformed school_id', async () => {
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, school_id: undefined })), [
      'school_id',
    ]);
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, school_id: 'not-a-uuid' })), [
      'school_id',
    ]);
  });

  it('rejects a missing or malformed email', async () => {
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, email: undefined })), [
      'email',
    ]);
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, email: 'not-an-email' })), [
      'email',
    ]);
  });

  it('rejects a missing or empty password', async () => {
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, password: undefined })), [
      'password',
    ]);
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, password: '' })), ['password']);
  });
});
