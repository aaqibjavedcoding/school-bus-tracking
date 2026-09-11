import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatCurrency, PLATFORM_CURRENCY } from './format.ts';

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
