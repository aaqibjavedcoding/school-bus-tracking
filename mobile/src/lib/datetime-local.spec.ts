import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fromDateTimeLocalValue,
  isValidDateTimeLocal,
  joinDateTimeLocal,
  maskDate,
  maskTime,
  splitDateTimeLocal,
  toDateTimeLocalValue,
} from './datetime.ts';

test('toDateTimeLocalValue renders a zero-padded local datetime value', () => {
  assert.equal(toDateTimeLocalValue(new Date(2026, 0, 5, 7, 3)), '2026-01-05T07:03');
  assert.equal(toDateTimeLocalValue(new Date(2026, 11, 31, 23, 59)), '2026-12-31T23:59');
});

test('splitDateTimeLocal separates the date and time halves', () => {
  assert.deepEqual(splitDateTimeLocal('2026-08-30T07:30'), {
    date: '2026-08-30',
    time: '07:30',
  });
  assert.deepEqual(splitDateTimeLocal(''), { date: '', time: '' });
  assert.deepEqual(splitDateTimeLocal('2026-08-30'), { date: '2026-08-30', time: '' });
});

test('isValidDateTimeLocal accepts real calendar instants only', () => {
  assert.equal(isValidDateTimeLocal('2026-08-30T07:30'), true);
  assert.equal(isValidDateTimeLocal('2026-02-29T07:30'), false, 'not a leap year');
  assert.equal(isValidDateTimeLocal('2024-02-29T07:30'), true, 'leap year');
  assert.equal(isValidDateTimeLocal('2026-13-01T07:30'), false);
  assert.equal(isValidDateTimeLocal('2026-08-30T24:00'), false);
  assert.equal(isValidDateTimeLocal('2026-08-30T07:60'), false);
  assert.equal(isValidDateTimeLocal('2026-08-30'), false);
  assert.equal(isValidDateTimeLocal(''), false);
});

test('fromDateTimeLocalValue round-trips through the local value', () => {
  const value = '2026-08-30T07:30';
  const iso = fromDateTimeLocalValue(value);
  assert.equal(toDateTimeLocalValue(new Date(iso)), value);
});

test('maskDate re-inserts separators while typing', () => {
  assert.equal(maskDate('2'), '2');
  assert.equal(maskDate('2026'), '2026');
  assert.equal(maskDate('202608'), '2026-08');
  assert.equal(maskDate('20260830'), '2026-08-30');
  assert.equal(maskDate('2026-08-30'), '2026-08-30');
  assert.equal(maskDate('2026083099'), '2026-08-30', 'extra digits are dropped');
});

test('maskTime re-inserts the colon while typing', () => {
  assert.equal(maskTime('0'), '0');
  assert.equal(maskTime('07'), '07');
  assert.equal(maskTime('073'), '07:3');
  assert.equal(maskTime('0730'), '07:30');
  assert.equal(maskTime('07:30'), '07:30');
});

test('joinDateTimeLocal is the inverse of splitDateTimeLocal', () => {
  const value = '2026-08-30T07:30';
  const { date, time } = splitDateTimeLocal(value);
  assert.equal(joinDateTimeLocal(date, time), value);
  assert.equal(joinDateTimeLocal('', ''), '', 'an empty form stays empty, never hardcoded');
});
