import 'reflect-metadata';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StudentGender } from '@school-bus-tracking/shared-types';
import { CreateStudentDto } from './create-student.dto';
import { ListStudentsQueryDto } from './list-students-query.dto';
import { UpdateStudentDto } from './update-student.dto';

const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const VALID_BODY = {
  admission_number: 'STU-101',
  first_name: 'Alice',
  last_name: 'Adams',
  gender: StudentGender.FEMALE,
  date_of_birth: '2016-03-15',
  grade_level: 'Grade 5',
};

async function validateCreate(body: Record<string, unknown>) {
  return validate(plainToInstance(CreateStudentDto, body));
}

async function validateUpdate(body: Record<string, unknown>) {
  return validate(plainToInstance(UpdateStudentDto, body));
}

describe('CreateStudentDto validation', () => {
  it('accepts a well-formed body', async () => {
    assert.equal((await validateCreate(VALID_BODY)).length, 0);
  });

  it('requires the core fields', async () => {
    const errors = await validateCreate({ ...VALID_BODY, first_name: undefined });
    assert.deepEqual(errors.map((error) => error.property).sort(), ['first_name']);
  });

  it('rejects an invalid date_of_birth', async () => {
    const errors = await validateCreate({ ...VALID_BODY, date_of_birth: '15-03-2016' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['date_of_birth'],
    );
  });

  it('rejects an unknown gender', async () => {
    const errors = await validateCreate({ ...VALID_BODY, gender: 'UNKNOWN' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['gender'],
    );
  });

  it('accepts nullable optional fields', async () => {
    const errors = await validateCreate({
      ...VALID_BODY,
      home_stop_id: null,
      medical_notes: null,
    });
    assert.equal(errors.length, 0);
  });

  it('rejects a school_id supplied by the client', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { ...VALID_BODY, school_id: SCHOOL_ID },
        { metatype: CreateStudentDto, type: 'body', data: '' },
      ),
      (error: { getStatus?: () => number }) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.getStatus?.(), 400);
        return true;
      },
    );
  });

  it('rejects an unknown field', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { ...VALID_BODY, owner_id: 'nope' },
        { metatype: CreateStudentDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('UpdateStudentDto validation', () => {
  it('accepts an empty partial update', async () => {
    assert.equal((await validateUpdate({})).length, 0);
  });

  it('accepts a single field update', async () => {
    assert.equal((await validateUpdate({ first_name: 'Alicia' })).length, 0);
  });

  it('rejects an invalid partial field', async () => {
    const errors = await validateUpdate({ home_stop_id: 'not-a-uuid' });
    assert.deepEqual(
      errors.map((error) => error.property),
      ['home_stop_id'],
    );
  });

  it('rejects a school_id supplied by the client', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    await assert.rejects(
      pipe.transform(
        { first_name: 'Alicia', school_id: SCHOOL_ID },
        { metatype: UpdateStudentDto, type: 'body', data: '' },
      ),
      BadRequestException,
    );
  });
});

describe('ListStudentsQueryDto validation', () => {
  it('applies sensible pagination defaults', async () => {
    const instance = plainToInstance(ListStudentsQueryDto, {});
    const errors = await validate(instance);
    assert.equal(errors.length, 0);
    assert.equal(instance.page, 1);
    assert.equal(instance.limit, 20);
  });

  it('rejects out-of-range pagination', async () => {
    const errors = await validate(plainToInstance(ListStudentsQueryDto, { page: 0, limit: 500 }));
    assert.deepEqual(errors.map((error) => error.property).sort(), ['limit', 'page']);
  });
});
