import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  EMPTY_REPORT_FILTERS,
  REPORT_CATEGORY_LABELS,
  REPORT_CATEGORY_ORDER,
  appliedFilterLabels,
  buildReportQuery,
  formatReportCell,
  formatReportCount,
  groupThousands,
  reportFiltersActive,
  reportRowEntries,
} from './reports.ts';

/**
 * Guards for the school-admin reports screens: the filter-state → query
 * mapping must mirror the web console (only declared keys, only set values),
 * and cell/figure formatting must be deterministic on devices without ICU.
 */

describe('buildReportQuery', () => {
  it('includes only declared filters that carry a value', () => {
    const query = buildReportQuery(
      { ...EMPTY_REPORT_FILTERS, search: 'ada', route_id: 'route-1', bus_id: '' },
      ['search', 'route_id', 'bus_id'],
      2,
    );
    assert.deepEqual(query, { page: 2, limit: 20, search: 'ada', route_id: 'route-1' });
  });

  it('never leaks undeclared keystrokes into the request', () => {
    const query = buildReportQuery(
      { ...EMPTY_REPORT_FILTERS, search: 'ada', bus_id: 'bus-1' },
      ['bus_id'],
      1,
    );
    assert.deepEqual(query, { page: 1, limit: 20, bus_id: 'bus-1' });
  });
});

describe('appliedFilterLabels / reportFiltersActive', () => {
  it('lists only set, declared filters', () => {
    const labels = appliedFilterLabels(
      { ...EMPTY_REPORT_FILTERS, search: 'ada', bus_id: 'bus-1' },
      ['search', 'bus_id', 'status'],
      (key, value) => (key === 'bus_id' ? 'Bus 7' : value),
    );
    assert.deepEqual(labels, ['ada', 'Bus 7']);
    assert.equal(reportFiltersActive({ ...EMPTY_REPORT_FILTERS }, ['search']), false);
    assert.equal(
      reportFiltersActive({ ...EMPTY_REPORT_FILTERS, status: 'active' }, ['status']),
      true,
    );
  });
});

describe('groupThousands', () => {
  it('groups by three digits without ICU', () => {
    assert.equal(groupThousands(0), '0');
    assert.equal(groupThousands(999), '999');
    assert.equal(groupThousands(1000), '1,000');
    assert.equal(groupThousands(1234567), '1,234,567');
    assert.equal(groupThousands(-12345), '-12,345');
  });

  it('keeps decimals intact', () => {
    assert.equal(groupThousands(1234.5), '1,234.5');
  });
});

describe('formatReportCount', () => {
  it('formats summary figures grouped', () => {
    assert.equal(formatReportCount(1248), '1,248');
  });
});

describe('formatReportCell', () => {
  it('renders the em dash for empty values', () => {
    assert.equal(formatReportCell(null, { type: 'text' }), '—');
    assert.equal(formatReportCell(undefined, { type: 'number' }), '—');
    assert.equal(formatReportCell('', { type: 'text' }), '—');
  });

  it('groups numeric columns and passes text through', () => {
    assert.equal(formatReportCell(12345, { type: 'number' }), '12,345');
    assert.equal(formatReportCell('North Loop', { type: 'text' }), 'North Loop');
  });
});

describe('reportRowEntries', () => {
  it('maps every column to a label/value pair in declaration order', () => {
    const entries = reportRowEntries({ name: 'North Loop', riders: 42 }, [
      { key: 'name', label: 'Route', type: 'text' },
      { key: 'riders', label: 'Riders', type: 'number' },
    ]);
    assert.deepEqual(entries, [
      { key: 'name', label: 'Route', value: 'North Loop' },
      { key: 'riders', label: 'Riders', value: '42' },
    ]);
  });
});

describe('category ordering', () => {
  it('keeps the web landing-page order and a label for every category', () => {
    assert.deepEqual(REPORT_CATEGORY_ORDER, [
      'students',
      'transport',
      'trips',
      'attendance',
      'compliance',
    ]);
    for (const category of REPORT_CATEGORY_ORDER) {
      assert.ok(REPORT_CATEGORY_LABELS[category], `missing label for ${category}`);
    }
  });
});
