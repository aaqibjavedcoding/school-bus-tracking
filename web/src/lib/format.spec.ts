import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  formatCurrency,
  fromDateTimeLocalValue,
  PLATFORM_CURRENCY,
  schoolDateOnly,
} from './format.ts';

/**
 * Currency display for the Super Admin Plans catalogue, the platform
 * dashboards and the revenue screens.
 *
 * Every price in those areas is rendered through this one function, with the
 * currency code stored on the plan/subscription row itself. What the tests pin
 * down is the India-focused default (a rupee, never a dollar) plus the rule
 * that formatting is presentation only: the amount that goes in is the amount
 * that comes back out, so no display path can quietly convert a price.
 */

/** Digits only, so the assertions do not depend on a locale's separators. */
function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

describe('formatCurrency', () => {
  it('uses the platform currency when a record carries none', () => {
    assert.equal(PLATFORM_CURRENCY, 'INR');
    for (const missing of [undefined, null, '', '   ']) {
      const formatted = formatCurrency(1999, missing);
      assert.ok(formatted.includes('₹'), `expected a rupee sign, got "${formatted}"`);
      assert.ok(!formatted.includes('$'), `rupee amounts must never show "$": ${formatted}`);
      assert.equal(digitsOnly(formatted), '199900');
    }
  });

  it('normalises a lower-case or padded currency code', () => {
    assert.equal(digitsOnly(formatCurrency(49, 'inr ')), '4900');
    const dollars = formatCurrency(49, 'UsD');
    assert.ok(!dollars.includes('₹'), `a USD row keeps its own symbol: ${dollars}`);
    assert.equal(digitsOnly(dollars), '4900');
  });

  it('groups rupee amounts the Indian way', () => {
    // en-IN grouping: three last digits, then pairs — 1,99,900 not 199,900.
    assert.match(formatCurrency(199900, 'INR'), /₹1,99,900\.00/);
  });

  it('never changes the number it is given', () => {
    const amounts: Array<[number, string]> = [
      [0, 'INR'],
      [49.001, 'INR'],
      [1200, 'USD'],
      [999999.99, 'INR'],
      [-49, 'INR'],
    ];
    for (const [amount, currency] of amounts) {
      assert.equal(
        digitsOnly(formatCurrency(amount, currency)),
        Math.abs(amount).toFixed(2).replace('.', ''),
        `amount ${amount} (${currency}) must survive formatting unchanged`,
      );
    }
  });

  it('accepts a string amount, as the API returns prices', () => {
    assert.equal(digitsOnly(formatCurrency('1999.00', 'INR')), '199900');
  });

  it('falls back to code + number instead of throwing on junk', () => {
    assert.equal(formatCurrency(Number.NaN, 'INR'), 'INR 0');
    assert.equal(formatCurrency('not-a-number', 'INR'), 'INR 0');
    // An unknown ISO code is neither a crash nor a rupee.
    assert.match(formatCurrency(12, 'XX'), /XX 12\.00/);
  });
});

describe('schoolDateOnly', () => {
  it('uses the configured school timezone instead of the UTC date', () => {
    assert.equal(
      schoolDateOnly('Asia/Kolkata', new Date('2026-09-23T23:30:00.000Z')),
      '2026-09-24',
    );
    assert.equal(
      schoolDateOnly('America/Los_Angeles', new Date('2026-09-24T05:00:00.000Z')),
      '2026-09-23',
    );
  });
});

/**
 * Scheduling regression: a `datetime-local` value is the school's wall clock,
 * never the device's. An admin whose browser runs in a different timezone
 * than the school used to get `new Date(value)` — a device-timezone reading —
 * which could save a 2 October 07:00 trip as a 1 October instant (and hide it
 * from the driver's "today" list). These tests pin the school-timezone
 * conversion on the reported zones, on both ends of the schedule, and keep
 * the legacy device-timezone fallback for sessions without a timezone.
 */
describe('fromDateTimeLocalValue', () => {
  it('interprets the value in the school timezone: Asia/Kolkata (UTC+5:30)', () => {
    assert.equal(
      fromDateTimeLocalValue('2026-10-02T07:00', 'Asia/Kolkata'),
      '2026-10-02T01:30:00.000Z',
    );
    assert.equal(
      fromDateTimeLocalValue('2026-10-02T15:30', 'Asia/Kolkata'),
      '2026-10-02T10:00:00.000Z',
    );
  });

  it('interprets the value in the school timezone: America/Chicago (UTC-5 CDT)', () => {
    assert.equal(
      fromDateTimeLocalValue('2026-10-02T07:00', 'America/Chicago'),
      '2026-10-02T12:00:00.000Z',
    );
  });

  it('follows the school timezone across its daylight-saving change', () => {
    // Chicago leaves DST on 1 November 2026: 2 October is CDT (UTC-5) but
    // 2 November is CST (UTC-6). The same wall clock maps to different
    // instants — the zone's rules, not a fixed offset, drive the conversion.
    assert.equal(
      fromDateTimeLocalValue('2026-11-02T07:00', 'America/Chicago'),
      '2026-11-02T13:00:00.000Z',
    );
  });

  it('keeps a trip scheduled on 2 October on 2 October in the school timezone', () => {
    // The instant the API receives must land on the same school-local
    // calendar date the trip lists filter by (schoolDateOnly), for the
    // school admin and the driver alike.
    for (const timeZone of ['Asia/Kolkata', 'America/Chicago']) {
      const iso = fromDateTimeLocalValue('2026-10-02T07:00', timeZone);
      assert.equal(schoolDateOnly(timeZone, new Date(iso)), '2026-10-02');
    }
  });

  it('does not use the device timezone when a school timezone is configured', () => {
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

  it('applies the school timezone to both ends of the schedule', () => {
    const timeZone = 'Asia/Kolkata';
    const start = fromDateTimeLocalValue('2026-10-02T07:00', timeZone);
    const end = fromDateTimeLocalValue('2026-10-02T09:00', timeZone);
    assert.equal(start, '2026-10-02T01:30:00.000Z');
    assert.equal(end, '2026-10-02T03:30:00.000Z');
    assert.ok(Date.parse(end) > Date.parse(start), 'the end must follow the start');
  });

  it('keeps the legacy device-timezone reading when no school timezone is available', () => {
    // Legacy sessions (and any timezone the runtime cannot resolve) must
    // behave exactly as before the school-timezone conversion existed.
    const expected = new Date('2026-10-02T07:00').toISOString();
    assert.equal(fromDateTimeLocalValue('2026-10-02T07:00'), expected);
    assert.equal(fromDateTimeLocalValue('2026-10-02T07:00', null), expected);
    assert.equal(fromDateTimeLocalValue('2026-10-02T07:00', ''), expected);
    assert.equal(fromDateTimeLocalValue('2026-10-02T07:00', 'Not/AZone'), expected);
  });
});
