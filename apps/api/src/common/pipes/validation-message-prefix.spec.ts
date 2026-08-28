import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateAdminSchoolDto } from '../../modules/admin/dto/create-admin-school.dto';
import { OnboardSchoolDto } from '../../modules/schools/dto/onboard-school.dto';

/**
 * Regression guard for doubled field paths in 400 responses
 * (`school.school.code must be …`).
 *
 * The school onboarding bodies are nested (`@ValidateNested()` on `school` and
 * `admin`). Nest's `ValidationPipe.prependConstraintsWithParentProp()`
 * unconditionally builds `` `${parentPath}.${message}` `` for every child
 * constraint, so a DTO message that already starts with `school.` / `admin.`
 * is reported twice. The DTO messages must stay unprefixed — these tests run
 * the real pipe with the real options from `main.ts` and fail if a prefix is
 * reintroduced.
 */

/** The exact pipe the API registers globally (see `src/main.ts`). */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

async function flattenedMessages(
  metatype: unknown,
  body: Record<string, unknown>,
): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: metatype as never, data: undefined });
    throw new Error('expected validation to reject the body');
  } catch (error) {
    assert.ok(error instanceof BadRequestException, `unexpected error: ${String(error)}`);
    const response = error.getResponse() as { message: string | string[] };
    return Array.isArray(response.message) ? response.message : [response.message];
  }
}

describe('nested DTO validation messages are prefixed exactly once', () => {
  it('reports POST /admin/schools field errors as `school.*` / `admin.*`', async () => {
    const messages = await flattenedMessages(CreateAdminSchoolDto, {
      school: { name: 'Bad', code: 'Bad Code' },
      admin: { first_name: 'A', last_name: 'B', email: 'not-an-email', password: 'short' },
    });

    assert.deepEqual(messages.sort(), [
      'admin.email must be a valid email address',
      'admin.password must be at least 8 characters',
      'school.code must be lowercase alphanumeric segments separated by hyphens',
    ]);
  });

  it('reports POST /schools field errors as `school.*` / `admin.*`', async () => {
    const messages = await flattenedMessages(OnboardSchoolDto, {
      school: { name: 'Bad', code: 'Bad Code' },
      admin: { name: 'Cher', email: 'not-an-email', password: 'short' },
    });

    assert.deepEqual(messages.sort(), [
      'admin.email must be a valid email address',
      'admin.name must include first and last name',
      'admin.password must be at least 8 characters',
      'school.code must be lowercase alphanumeric segments separated by hyphens',
    ]);
  });

  it('never doubles the parent path in any nested message', async () => {
    const bodies = [
      {
        metatype: CreateAdminSchoolDto,
        body: {
          school: { name: '', code: 'x', country: 'USA', timezone: 'x'.repeat(65) },
          admin: { first_name: '', last_name: '', email: 'x', password: ' y ' },
        },
      },
      {
        metatype: OnboardSchoolDto,
        body: {
          school: { name: '', code: 'x' },
          admin: { name: '', email: 'x', password: ' y ' },
        },
      },
    ];

    for (const { metatype, body } of bodies) {
      const messages = await flattenedMessages(metatype, body);
      assert.ok(messages.length > 0);
      for (const message of messages) {
        assert.doesNotMatch(
          message,
          /^(school|admin)\.(school|admin)\./,
          `doubled prefix in "${message}"`,
        );
        assert.match(
          message,
          /^(school|admin)\.[a-z0-9_]+ /,
          `message is missing its single parent path: "${message}"`,
        );
      }
    }
  });

  it('keeps top-level body errors unprefixed', async () => {
    // A missing block fails both @IsDefined and @IsObject on that property.
    const messages = await flattenedMessages(CreateAdminSchoolDto, { admin: undefined });

    assert.deepEqual(messages.sort(), [
      'admin is required',
      'admin must be an object',
      'school is required',
      'school must be an object',
    ]);
    for (const message of messages) {
      assert.doesNotMatch(message, /^(school|admin)\./, `unexpected prefix in "${message}"`);
    }
  });
});
