import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMonths,
  compareDateOnly,
  daysInMonth,
  firstDayWeekday,
  formatDateOnly,
  isRealDate,
  isValidDateOnly,
  monthGrid,
  parseDateOnly,
} from './calendar.ts';

describe('daysInMonth', () => {
  it('knows the common month lengths', () => {
    assert.equal(daysInMonth(2026, 1), 31);
    assert.equal(daysInMonth(2026, 4), 30);
    assert.equal(daysInMonth(2026, 9), 30);
  });

  it('is leap-year aware for February', () => {
    assert.equal(daysInMonth(2024, 2), 29, '2024 is a leap year');
    assert.equal(daysInMonth(2026, 2), 28, '2026 is not');
    assert.equal(daysInMonth(2000, 2), 29, 'divisible by 400 is a leap year');
    assert.equal(daysInMonth(1900, 2), 28, 'divisible by 100 but not 400 is not');
  });

  it('returns 0 for an out-of-range month', () => {
    assert.equal(daysInMonth(2026, 0), 0);
    assert.equal(daysInMonth(2026, 13), 0);
  });
});

describe('isRealDate', () => {
  it('accepts ordinary days', () => {
    assert.ok(isRealDate(2026, 9, 22));
    assert.ok(isRealDate(2024, 2, 29));
  });

  it('rejects impossible days', () => {
    assert.ok(!isRealDate(2026, 2, 29), 'no 29 February in a common year');
    assert.ok(!isRealDate(2026, 4, 31), 'April has 30 days');
    assert.ok(!isRealDate(2026, 6, 0));
    assert.ok(!isRealDate(2026, 13, 1));
  });
});

describe('parseDateOnly / isValidDateOnly', () => {
  it('parses a well-formed real date', () => {
    assert.deepEqual(parseDateOnly('2024-02-29'), { year: 2024, month: 2, day: 29 });
  });

  it('rejects the wrong shapes', () => {
    for (const value of [
      '',
      '2026-2-9',
      '26-09-22',
      '22/09/2026',
      '2026-09-22T00:00',
      'not a date',
      '2026-13-01',
      '2026-09-32',
      '2026-02-30',
    ]) {
      assert.equal(parseDateOnly(value), null, `expected ${value} to be rejected`);
      assert.equal(isValidDateOnly(value), false);
    }
  });

  it('accepts a well-formed real date round trip', () => {
    const parsed = parseDateOnly('2024-02-29');
    assert.deepEqual(parsed, { year: 2024, month: 2, day: 29 });
    assert.equal(formatDateOnly(parsed!), '2024-02-29');
    assert.ok(isValidDateOnly('2024-02-29'));
  });
});

describe('formatDateOnly', () => {
  it('zero-pads and keeps the API unit', () => {
    assert.equal(formatDateOnly({ year: 2026, month: 1, day: 5 }), '2026-01-05');
  });
});

describe('monthGrid', () => {
  it('has exactly 42 cells, one per (weekday, week) slot', () => {
    assert.equal(monthGrid(2026, 9).length, 42);
  });

  it('places day 1 under the correct weekday column', () => {
    for (const [year, month] of [
      [2026, 9],
      [2026, 2],
      [2024, 1],
      [2026, 12],
    ] as const) {
      const grid = monthGrid(year, month);
      const firstIndex = grid.findIndex((cell) => cell !== null);
      assert.equal(
        firstIndex,
        firstDayWeekday(year, month),
        `1 ${month}/${year} must sit in the ${firstDayWeekday(year, month)} column`,
      );
      assert.deepEqual(grid[firstIndex], { year, month, day: 1 });
    }
  });

  it('fills exactly daysInMonth cells and no gaps inside the month', () => {
    for (let month = 1; month <= 12; month += 1) {
      const grid = monthGrid(2026, month);
      const filled = grid.filter((cell) => cell !== null);
      assert.equal(filled.length, daysInMonth(2026, month), `September-like count for ${month}`);
      const days = filled.map((cell) => cell!.day);
      for (let i = 0; i < days.length; i += 1) {
        assert.equal(days[i], i + 1, `day ${i + 1} of ${month} in order`);
      }
    }
  });

  it('matches the reference Date weekday for the month start', () => {
    // A known anchor: 2026-09-01 is a Monday (UTC).
    assert.equal(firstDayWeekday(2026, 9), new Date(Date.UTC(2026, 8, 1)).getUTCDay());
  });
});

describe('addMonths', () => {
  it('steps forward and backward across year boundaries', () => {
    assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(addMonths(2026, 3, 10), { year: 2027, month: 1 });
  });

  it('is a no-op for zero', () => {
    assert.deepEqual(addMonths(2026, 9, 0), { year: 2026, month: 9 });
  });
});

describe('compareDateOnly', () => {
  it('orders calendar days', () => {
    assert.equal(compareDateOnly('2026-09-22', '2026-09-23'), -1);
    assert.equal(compareDateOnly('2026-09-23', '2026-09-22'), 1);
    assert.equal(compareDateOnly('2026-09-22', '2026-09-22'), 0);
    assert.equal(compareDateOnly('2025-12-31', '2026-01-01'), -1);
    assert.equal(compareDateOnly('2026-02-28', '2026-02-03'), 1);
  });

  it('treats unparseable values as incomparable (0)', () => {
    assert.equal(compareDateOnly('', '2026-01-01'), 0);
    assert.equal(compareDateOnly('2026-02-30', '2026-01-01'), 0);
  });
});
