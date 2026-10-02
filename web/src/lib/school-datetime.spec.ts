import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { fromSchoolDateTimeLocalValue, toSchoolDateTimeLocalValue } from './school-datetime.ts';

/**
 * The regression behind "trip scheduled for today shows as yesterday and the
 * driver cannot see it": the wall time a dispatcher types is school time, so
 * the conversion to a UTC instant must honour the school's timezone — not a
 * (possibly misconfigured) device timezone.
 */

describe('fromSchoolDateTimeLocalValue', () => {
  it('converts a school wall time to the correct instant in Asia/Kolkata', () => {
    // 07:30 in Kolkata is 02:00 UTC — on the SAME calendar day.
    assert.equal(
      fromSchoolDateTimeLocalValue('2026-10-02T07:30', 'Asia/Kolkata'),
      '2026-10-02T02:00:00.000Z',
    );
  });

  it('keeps the school-local calendar day identical to the picked day', () => {
    // An early-morning trip must not slide into the previous school day.
    const instant = fromSchoolDateTimeLocalValue('2026-10-02T00:30', 'Asia/Kolkata');
    assert.equal(instant, '2026-10-01T19:00:00.000Z');
    assert.equal(toSchoolDateTimeLocalValue(new Date(instant), 'Asia/Kolkata'), '2026-10-02T00:30');
  });

  it('honours US daylight-saving offsets for non-Indian tenants', () => {
    // October: Chicago is UTC-5 (CDT).
    assert.equal(
      fromSchoolDateTimeLocalValue('2026-10-02T07:30', 'America/Chicago'),
      '2026-10-02T12:30:00.000Z',
    );
    // March 1: Chicago is UTC-6 (CST) — proves the offset is date-dependent.
    assert.equal(
      fromSchoolDateTimeLocalValue('2026-03-01T07:30', 'America/Chicago'),
      '2026-03-01T13:30:00.000Z',
    );
  });

  it('round-trips through toSchoolDateTimeLocalValue', () => {
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

  it('falls back to the device interpretation without a usable timezone', () => {
    for (const timeZone of [undefined, null, '', 'Not/AZone']) {
      assert.equal(
        fromSchoolDateTimeLocalValue('2026-10-02T07:30', timeZone),
        new Date('2026-10-02T07:30').toISOString(),
      );
    }
  });
});

describe('toSchoolDateTimeLocalValue', () => {
  it('renders an instant as the school wall clock', () => {
    assert.equal(
      toSchoolDateTimeLocalValue(new Date('2026-10-02T02:00:00.000Z'), 'Asia/Kolkata'),
      '2026-10-02T07:30',
    );
    assert.equal(
      toSchoolDateTimeLocalValue(new Date('2026-10-02T02:00:00.000Z'), 'America/Chicago'),
      '2026-10-01T21:00',
    );
  });

  it('falls back to the device wall clock without a usable timezone', () => {
    const date = new Date(2026, 9, 2, 7, 30);
    const expected = '2026-10-02T07:30';
    assert.equal(toSchoolDateTimeLocalValue(date, undefined), expected);
    assert.equal(toSchoolDateTimeLocalValue(date, 'Not/AZone'), expected);
  });
});
