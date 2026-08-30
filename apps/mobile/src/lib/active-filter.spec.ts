import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACTIVE_FILTER_OPTIONS, activeFilterLabel, filterByActive } from './active-filter.ts';

const rows = [
  { id: 'a', is_active: true },
  { id: 'b', is_active: false },
  { id: 'c', is_active: true },
];

test('ALL keeps every row', () => {
  assert.deepEqual(
    filterByActive(rows, 'ALL').map((row) => row.id),
    ['a', 'b', 'c'],
  );
});

test('ACTIVE / INACTIVE narrow the list', () => {
  assert.deepEqual(
    filterByActive(rows, 'ACTIVE').map((row) => row.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    filterByActive(rows, 'INACTIVE').map((row) => row.id),
    ['b'],
  );
});

test('filtering an empty list is safe', () => {
  assert.deepEqual(filterByActive([], 'ACTIVE'), []);
});

test('every filter value has a chip label', () => {
  assert.deepEqual(
    ACTIVE_FILTER_OPTIONS.map((option) => option.value),
    ['ALL', 'ACTIVE', 'INACTIVE'],
  );
  assert.equal(activeFilterLabel('INACTIVE'), 'Inactive');
});
