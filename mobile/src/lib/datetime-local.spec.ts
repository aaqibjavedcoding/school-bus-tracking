import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schoolDateOnly } from './format.ts';
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

// Scheduling regression: a `datetime-local` value is the school's wall clock,
// never the device's. An admin whose phone runs in a different timezone than
// the school used to get `new Date(value)` — a device-timezone reading —
// which could save a 2 October 07:00 trip as a 1 October instant (and hide it
// from the driver's "today" list). These tests pin the school-timezone
// conversion on the reported zones, on both ends of the schedule, and keep
// the legacy device-timezone fallback for sessions without a timezone.
test('fromDateTimeLocalValue interprets the value in the school timezone (Asia/Kolkata, UTC+5:30)', () => {
  assert.equal(
    fromDateTimeLocalValue('2026-10-02T07:00', 'Asia/Kolkata'),
    '2026-10-02T01:30:00.000Z',
  );
  assert.equal(
    fromDateTimeLocalValue('2026-10-02T15:30', 'Asia/Kolkata'),
    '2026-10-02T10:00:00.000Z',
  );
});

test('fromDateTimeLocalValue interprets the value in the school timezone (America/Chicago, UTC-5 CDT)', () => {
  assert.equal(
    fromDateTimeLocalValue('2026-10-02T07:00', 'America/Chicago'),
    '2026-10-02T12:00:00.000Z',
  );
});

test('fromDateTimeLocalValue follows the school timezone across its daylight-saving change', () => {
  // Chicago leaves DST on 1 November 2026: 2 October is CDT (UTC-5) but
  // 2 November is CST (UTC-6). The zone's rules, not a fixed offset, drive
  // the conversion.
  assert.equal(
    fromDateTimeLocalValue('2026-11-02T07:00', 'America/Chicago'),
    '2026-11-02T13:00:00.000Z',
  );
});

test('a trip scheduled on 2 October stays on 2 October in the school timezone', () => {
  // The instant the API receives must land on the same school-local calendar
  // date the trip lists filter by (schoolDateOnly), for the school admin and
  // the driver alike.
  for (const timeZone of ['Asia/Kolkata', 'America/Chicago']) {
    const iso = fromDateTimeLocalValue('2026-10-02T07:00', timeZone);
    assert.equal(schoolDateOnly(timeZone, new Date(iso)), '2026-10-02');
  }
});

test('fromDateTimeLocalValue never uses the device timezone when a school timezone is set', () => {
  // A device ahead of the school (the reported bug: the trip fell back to
  // 1 October) and a device behind it must produce the same instant.
  const originalTz = process.env.TZ;
  try {
    for (const deviceTz of ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = deviceTz;
      assert.equal(
        fromDateTimeLocalValue('2026-10-02T07:00', 'America/Chicago'),
        '2026-10-02T12:00:00.000Z',
        `device timezone ${deviceTz} leaked into the conversion`,
      );
      assert.equal(
        fromDateTimeLocalValue('2026-10-02T07:00', 'Asia/Kolkata'),
        '2026-10-02T01:30:00.000Z',
        `device timezone ${deviceTz} leaked into the conversion`,
      );
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test('fromDateTimeLocalValue applies the school timezone to both ends of the schedule', () => {
  const timeZone = 'Asia/Kolkata';
  const start = fromDateTimeLocalValue('2026-10-02T07:00', timeZone);
  const end = fromDateTimeLocalValue('2026-10-02T09:00', timeZone);
  assert.equal(start, '2026-10-02T01:30:00.000Z');
  assert.equal(end, '2026-10-02T03:30:00.000Z');
  assert.ok(Date.parse(end) > Date.parse(start), 'the end must follow the start');
});

test('fromDateTimeLocalValue keeps the legacy device-timezone reading without a school timezone', () => {
  // Legacy sessions (and any timezone the runtime cannot resolve) must
  // behave exactly as before the school-timezone conversion existed.
  const expected = new Date('2026-10-02T07:00').toISOString();
  assert.equal(fromDateTimeLocalValue('2026-10-02T07:00'), expected);
  assert.equal(fromDateTimeLocalValue('2026-10-02T07:00', null), expected);
  assert.equal(fromDateTimeLocalValue('2026-10-02T07:00', ''), expected);
  assert.equal(fromDateTimeLocalValue('2026-10-02T07:00', 'Not/AZone'), expected);
});

test('toDateTimeLocalValue renders the school wall clock when a timezone is given', () => {
  // The "Now" quick action must fill the school's current time — 07:00 in
  // Kolkata is 01:30 UTC — regardless of where the device sits.
  assert.equal(
    toDateTimeLocalValue(new Date('2026-10-02T01:30:00.000Z'), 'Asia/Kolkata'),
    '2026-10-02T07:00',
  );
  assert.equal(
    toDateTimeLocalValue(new Date('2026-10-02T01:30:00.000Z'), 'America/Chicago'),
    '2026-10-01T20:30',
  );
  // Without a timezone the device-local reading is kept.
  const expected = toDateTimeLocalValue(new Date('2026-10-02T01:30:00.000Z'));
  assert.equal(toDateTimeLocalValue(new Date('2026-10-02T01:30:00.000Z'), 'Not/AZone'), expected);
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
