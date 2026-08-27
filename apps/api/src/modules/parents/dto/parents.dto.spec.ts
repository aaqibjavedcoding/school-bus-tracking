import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  parentCreateSchema,
  parentStudentRelationshipCreateSchema,
} from '@school-bus-tracking/validation';
import { CreateParentDto } from './create-parent.dto';
import { CreateParentStudentRelationshipDto } from './create-parent-student-relationship.dto';
import { CreateStudentGuardianDto } from './create-student-guardian.dto';
import { UpdateParentDto } from './update-parent.dto';
import { UpdateParentStudentRelationshipDto } from './update-parent-student-relationship.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_ID = '33333333-3333-4333-8333-333333333333';

const VALID_PARENT = {
  first_name: '  Alicia ',
  last_name: ' Adams ',
  email: ' Parent@Example.ORG ',
  password: 'correct-horse-battery',
  phone: ' +1 555 0100 ',
  is_active: false,
};

async function errorsFor<T extends object>(type: new () => T, body: Record<string, unknown>) {
  return validate(plainToInstance(type, body));
}

describe('parent account DTO validation', () => {
  it('accepts a valid account and transforms safe fields', async () => {
    const dto = plainToInstance(CreateParentDto, VALID_PARENT);
    assert.equal((await validate(dto)).length, 0);
    assert.equal(dto.first_name, 'Alicia');
    assert.equal(dto.last_name, 'Adams');
    assert.equal(dto.email, 'parent@example.org');
    assert.equal(dto.phone, '+1 555 0100');
    assert.equal(dto.is_active, false);
  });

  it('requires names, email and a policy-compliant password', async () => {
    const errors = await errorsFor(CreateParentDto, {
      first_name: undefined,
      last_name: 'Adams',
      email: 'not-an-email',
      password: 'short',
    });
    assert.deepEqual(errors.map((error) => error.property).sort(), [
      'email',
      'first_name',
      'password',
    ]);
  });

  it('rejects password whitespace at either boundary', async () => {
    const errors = await errorsFor(CreateParentDto, {
      ...VALID_PARENT,
      password: ' password-with-space ',
    });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['password'],
    );
  });

  it('rejects client-controlled tenant and role fields through the global pipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    for (const field of ['school_id', 'role', 'password_hash']) {
      await assert.rejects(
        pipe.transform(
          { ...VALID_PARENT, [field]: field === 'school_id' ? SCHOOL_ID : 'PARENT' },
          { metatype: CreateParentDto, type: 'body', data: '' },
        ),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          return true;
        },
      );
    }
  });

  it('validates partial updates and rejects an empty password', async () => {
    assert.equal((await errorsFor(UpdateParentDto, {})).length, 0);
    const errors = await errorsFor(UpdateParentDto, { password: 'short' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['password'],
    );
  });
});

describe('student ↔ parent relationship DTO validation', () => {
  it('accepts a parent-centred link and preserves false boolean values', async () => {
    const dto = plainToInstance(CreateParentStudentRelationshipDto, {
      student_id: STUDENT_ID,
      relationship: '  Mother ',
      can_pick_up: false,
      is_primary: true,
    });
    assert.equal((await validate(dto)).length, 0);
    assert.equal(dto.relationship, 'Mother');
    assert.equal(dto.can_pick_up, false);
  });

  it('requires a UUID student id and non-empty relationship', async () => {
    const errors = await errorsFor(CreateParentStudentRelationshipDto, {
      student_id: 'not-a-uuid',
      relationship: '   ',
    });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['relationship', 'student_id']);
  });

  it('supports the student-centred body with parent_id', async () => {
    const dto = plainToInstance(CreateStudentGuardianDto, {
      parent_id: PARENT_ID,
      relationship: 'Legal guardian',
    });
    assert.equal((await validate(dto)).length, 0);
  });

  it('accepts an empty relationship update but rejects unknown tenant fields', async () => {
    assert.equal((await errorsFor(UpdateParentStudentRelationshipDto, {})).length, 0);
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { can_pick_up: true, school_id: SCHOOL_ID },
        { metatype: UpdateParentStudentRelationshipDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('parent Zod schemas', () => {
  it('validates parent creation and rejects a tenant field', () => {
    const parsed = parentCreateSchema.parse({
      first_name: 'Alicia',
      last_name: 'Adams',
      email: 'Parent@Example.org',
      password: 'correct-horse-battery',
    });
    assert.equal(parsed.email, 'parent@example.org');
    assert.throws(() => parentCreateSchema.parse({ ...parsed, school_id: SCHOOL_ID }));
  });

  it('validates relationship ids and metadata', () => {
    const parsed = parentStudentRelationshipCreateSchema.parse({
      student_id: STUDENT_ID,
      relationship: 'Father',
      can_pick_up: false,
    });
    assert.equal(parsed.can_pick_up, false);
    assert.throws(() =>
      parentStudentRelationshipCreateSchema.parse({ ...parsed, school_id: SCHOOL_ID }),
    );
  });
});
