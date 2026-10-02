import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fromDateTimeLocalValue,
  fromSchoolDateTimeLocalValue,
  isValidDateTimeLocal,
  joinDateTimeLocal,
  maskDate,
  maskTime,
  shiftDateTimeLocalValue,
  splitDateTimeLocal,
  toDateTimeLocalValue,
  toSchoolDateTimeLocalValue,
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

test('fromSchoolDateTimeLocalValue converts school wall time in Asia/Kolkata', () => {
  // 07:30 in Kolkata is 02:00 UTC — the SAME calendar day, so a morning trip
  // never slides into the previous school day.
  assert.equal(
    fromSchoolDateTimeLocalValue('2026-10-02T07:30', 'Asia/Kolkata'),
    '2026-10-02T02:00:00.000Z',
  );
  // The regression case: an early trip must not become "yesterday" for the
  // school (and thus vanish from the driver's "today" list).
  assert.equal(
    fromSchoolDateTimeLocalValue('2026-10-02T00:30', 'Asia/Kolkata'),
    '2026-10-01T19:00:00.000Z',
  );
});

test('fromSchoolDateTimeLocalValue honours date-dependent US DST offsets', () => {
  // October: Chicago is UTC-5 (CDT); March 1: UTC-6 (CST).
  assert.equal(
    fromSchoolDateTimeLocalValue('2026-10-02T07:30', 'America/Chicago'),
    '2026-10-02T12:30:00.000Z',
  );
  assert.equal(
    fromSchoolDateTimeLocalValue('2026-03-01T07:30', 'America/Chicago'),
    '2026-03-01T13:30:00.000Z',
  );
});

test('school helpers round-trip the wall clock', () => {
  for (const value of ['2026-01-15T06:45', '2026-06-30T14:05', '2026-12-31T23:55']) {
    for (const timeZone of ['Asia/Kolkata', 'America/Chicago', 'Pacific/Auckland', 'UTC']) {
      assert.equal(
        toSchoolDateTimeLocalValue(
          new Date(fromSchoolDateTimeLocalValue(value, timeZone)),
          timeZone,
        ),
        value,
        `${value} in ${timeZone}`,
      );
    }
  }
});

test('school helpers fall back to the device interpretation without a usable timezone', () => {
  const value = '2026-10-02T07:30';
  for (const timeZone of [undefined, null, '', 'Not/AZone']) {
    assert.equal(fromSchoolDateTimeLocalValue(value, timeZone), new Date(value).toISOString());
  }
  const date = new Date(2026, 9, 2, 7, 30);
  assert.equal(toSchoolDateTimeLocalValue(date, undefined), toDateTimeLocalValue(date));
  assert.equal(toSchoolDateTimeLocalValue(date, 'Not/AZone'), toDateTimeLocalValue(date));
});

test('shiftDateTimeLocalValue shifts wall time, rolling over midnight back and forth', () => {
  assert.equal(shiftDateTimeLocalValue('2026-10-02T07:30', 30), '2026-10-02T08:00');
  assert.equal(shiftDateTimeLocalValue('2026-10-02T07:15', 60), '2026-10-02T08:15');
  assert.equal(shiftDateTimeLocalValue('2026-10-02T23:45', 30), '2026-10-03T00:15');
  assert.equal(shiftDateTimeLocalValue('2026-10-02T00:15', -30), '2026-10-01T23:45');
  assert.equal(shiftDateTimeLocalValue('2026-01-01T00:00', -60), '2025-12-31T23:00');
});
