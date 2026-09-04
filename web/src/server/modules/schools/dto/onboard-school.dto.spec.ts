import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { OnboardSchoolDto } from './onboard-school.dto';

const VALID_BODY = {
  school: { name: 'Lincoln High School', code: 'lincoln-high' },
  admin: {
    name: 'Alicia Adams',
    email: 'admin@lincoln-high.org',
    password: 'correct-horse-battery',
  },
};

async function validateBody(body: Record<string, unknown>) {
  return validate(plainToInstance(OnboardSchoolDto, body));
}

function properties(errors: Awaited<ReturnType<typeof validateBody>>): string[] {
  return errors.map((error) => error.property).sort();
}

describe('OnboardSchoolDto validation', () => {
  it('accepts a well-formed onboarding body', async () => {
    const errors = await validateBody(VALID_BODY);
    assert.equal(errors.length, 0);
  });

  it('rejects a missing school or admin block', async () => {
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, school: undefined })), [
      'school',
    ]);
    assert.deepEqual(properties(await validateBody({ ...VALID_BODY, admin: undefined })), [
      'admin',
    ]);
  });

  it('rejects an invalid school code', async () => {
    for (const code of ['Lincoln High', 'UPPER-CASE', '-leading', 'trailing-', 'a']) {
      const errors = await validateBody({
        ...VALID_BODY,
        school: { ...VALID_BODY.school, code },
      });
      assert.ok(errors.length > 0, `expected code "${code}" to be rejected`);
    }
  });

  it('rejects admin names that do not include a first and last name', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      admin: { ...VALID_BODY.admin, name: 'Cher' },
    });
    assert.ok(errors.length > 0);
  });

  it('rejects an invalid admin email', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      admin: { ...VALID_BODY.admin, email: 'not-an-email' },
    });
    const adminError = errors.find((error) => error.property === 'admin');
    assert.ok(adminError, 'expected a nested admin validation error');
    const childProperties = (adminError?.children ?? []).map((error) => error.property).sort();
    assert.deepEqual(childProperties, ['email']);
  });

  it('rejects a too-short password', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      admin: { ...VALID_BODY.admin, password: 'short' },
    });
    assert.ok(errors.length > 0);
  });

  it('rejects a password with leading or trailing whitespace', async () => {
    const errors = await validateBody({
      ...VALID_BODY,
      admin: { ...VALID_BODY.admin, password: ' password-with-space ' },
    });
    assert.ok(errors.length > 0);
  });
});
