import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_TOKEN_LENGTH,
  forgotPasswordSchema,
  passwordSchema,
  resetPasswordSchema,
} from '@school-bus-tracking/validation';

import { ForgotPasswordDto, ResetPasswordDto } from './password-reset.dto';

/**
 * The two reset DTOs, and the property that matters most about them: **they
 * agree with the shared zod schemas the browser uses.**
 *
 * The reset page parses with `resetPasswordSchema` before it posts; the API
 * validates with `ResetPasswordDto`. If the two drift, either the console
 * blocks a password the API would have taken (annoying) or it accepts one the
 * API rejects, at the worst possible moment — the user has just typed a new
 * password twice from an emailed link that is now spent. The cross-check
 * below walks the same candidate list through both and requires the same
 * verdict.
 *
 * Messages are asserted to describe the *shape* of the input only. A
 * validation error that said anything about whether the account exists would
 * reopen the enumeration channel the endpoint's single generic response was
 * built to close.
 */

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 hex chars, the shape the server mints

async function validateForgot(body: Record<string, unknown>) {
  return validate(plainToInstance(ForgotPasswordDto, body));
}

async function validateReset(body: Record<string, unknown>) {
  return validate(plainToInstance(ResetPasswordDto, body));
}

/** Every message a rejected body produced, flattened. */
function messages(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('ForgotPasswordDto', () => {
  it('accepts a school code and an email', async () => {
    assert.equal((await validateForgot({ school_id: 'triumph-academy', email: 'a@b.edu' })).length, 0);
  });

  it('accepts a school UUID too, exactly as the login form does', async () => {
    assert.equal((await validateForgot({ school_id: SCHOOL_ID, email: 'a@b.edu' })).length, 0);
  });

  it('requires the school code — unlike login, there is no blank-means-platform case', async () => {
    // Self-service reset is SCHOOL_ADMIN-only, and a school admin always
    // belongs to exactly one tenant.
    const errors = await validateForgot({ email: 'a@b.edu' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['school_id'],
    );
    for (const body of [{ school_id: '', email: 'a@b.edu' }, { school_id: '   ', email: 'a@b.edu' }]) {
      assert.ok((await validateForgot(body)).length > 0, `expected a rejection for ${JSON.stringify(body)}`);
    }
  });

  it('rejects a malformed email', async () => {
    for (const email of ['not-an-email', 'a@', '@b.edu', '', 'a b@c.edu']) {
      const errors = await validateForgot({ school_id: 'triumph-academy', email });
      assert.deepEqual(
        errors.map((error) => error.property),
        ['email'],
        `expected an email rejection for ${JSON.stringify(email)}`,
      );
    }
  });

  it('rejects an oversized school code before it reaches the database', async () => {
    const errors = await validateForgot({ school_id: 'x'.repeat(64), email: 'a@b.edu' });
    assert.ok(errors.length > 0);
  });

  it('phrases every message about the input, never about the account', async () => {
    const all = messages(await validateForgot({ school_id: '', email: 'nope' }));
    assert.ok(all.length > 0);
    for (const message of all) {
      assert.equal(/exist|found|unknown|no account|registered/i.test(message), false, message);
      assert.match(message, /^Please /);
    }
  });
});

describe('ResetPasswordDto', () => {
  it('accepts a well-formed body', async () => {
    assert.equal((await validateReset({ token: TOKEN, password: 'new-password-123' })).length, 0);
  });

  it('requires a token', async () => {
    for (const token of [undefined, '', 123]) {
      const errors = await validateReset({ token, password: 'new-password-123' });
      assert.deepEqual(
        errors.map((error) => error.property),
        ['token'],
        `expected a token rejection for ${JSON.stringify(token)}`,
      );
    }
  });

  it('bounds the token length so a huge string is never hashed and looked up', async () => {
    assert.equal((await validateReset({ token: 'a'.repeat(PASSWORD_RESET_TOKEN_LENGTH), password: 'new-password-123' })).length, 0);
    assert.ok((await validateReset({ token: 'a'.repeat(PASSWORD_RESET_TOKEN_LENGTH + 1), password: 'new-password-123' })).length > 0);
  });

  it('says the same thing about every bad token', async () => {
    // The DTO only checks shape; authenticity is a digest lookup whose every
    // failure collapses to one message. This layer must not be cleverer.
    const short = messages(await validateReset({ token: '', password: 'new-password-123' }));
    const long = messages(
      await validateReset({ token: 'a'.repeat(500), password: 'new-password-123' }),
    );
    assert.deepEqual([...new Set([...short, ...long])], ['This password reset link is not valid.']);
  });

  it('enforces the shared minimum password length', async () => {
    const tooShort = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const errors = await validateReset({ token: TOKEN, password: tooShort });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['password'],
    );
    assert.equal((await validateReset({ token: TOKEN, password: 'a'.repeat(MIN_PASSWORD_LENGTH) })).length, 0);
  });

  it('rejects a password that starts or ends with a space', async () => {
    for (const password of [' leading-space-pw', 'trailing-space-pw ', '   ']) {
      assert.ok(
        (await validateReset({ token: TOKEN, password })).length > 0,
        `expected a rejection for ${JSON.stringify(password)}`,
      );
    }
  });

  it('rejects a password bcrypt would silently truncate', async () => {
    // bcrypt ignores everything past 72 bytes; accepting a 200-character
    // password would mean only its first 72 characters ever mattered.
    assert.ok((await validateReset({ token: TOKEN, password: 'a'.repeat(73) })).length > 0);
    assert.equal((await validateReset({ token: TOKEN, password: 'a'.repeat(72) })).length, 0);
  });
});

describe('DTO and shared schema agree', () => {
  /**
   * The password candidates both layers must judge identically. Each is a
   * mistake a real person makes on a reset form.
   */
  const passwords = [
    'new-password-123',
    'a'.repeat(MIN_PASSWORD_LENGTH),
    'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    '',
    ' leading',
    'trailing ',
    'sp ace in middle is fine',
    'a'.repeat(72),
  ];

  for (const password of passwords) {
    it(`agrees on ${JSON.stringify(password)}`, async () => {
      const dtoAccepts = (await validateReset({ token: TOKEN, password })).length === 0;
      const zodAccepts = passwordSchema.safeParse(password).success;
      assert.equal(
        dtoAccepts,
        zodAccepts,
        `DTO ${dtoAccepts ? 'accepted' : 'rejected'} but zod ${zodAccepts ? 'accepted' : 'rejected'}`,
      );
    });
  }

  it('agrees on complete reset bodies', async () => {
    const bodies = [
      { token: TOKEN, password: 'new-password-123' },
      { token: '', password: 'new-password-123' },
      { token: TOKEN, password: 'short' },
    ];
    for (const body of bodies) {
      const dtoAccepts = (await validateReset(body)).length === 0;
      const zodAccepts = resetPasswordSchema.safeParse(body).success;
      assert.equal(dtoAccepts, zodAccepts, `disagreement on ${JSON.stringify(body)}`);
    }
  });

  it('agrees on forgot-password bodies', async () => {
    const bodies = [
      { school_id: 'triumph-academy', email: 'a@b.edu' },
      { school_id: SCHOOL_ID, email: 'a@b.edu' },
      { school_id: '', email: 'a@b.edu' },
      { school_id: 'triumph-academy', email: 'not-an-email' },
    ];
    for (const body of bodies) {
      const dtoAccepts = (await validateForgot(body)).length === 0;
      const zodAccepts = forgotPasswordSchema.safeParse(body).success;
      assert.equal(dtoAccepts, zodAccepts, `disagreement on ${JSON.stringify(body)}`);
    }
  });
});
