import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SEARCH_DEBOUNCE_MS,
  filtersKey,
  isLatestRequest,
  isSearchSettled,
  isStaleResponse,
  normaliseSearch,
  searchParamFor,
  shouldResetPage,
} from './paged-query.ts';

describe('normaliseSearch', () => {
  it('trims the raw input', () => {
    assert.equal(normaliseSearch('  Aaqib  '), 'Aaqib');
  });

  it('preserves inner casing and spacing (the API matches case-insensitively)', () => {
    assert.equal(normaliseSearch(' Aarav Sharma '), 'Aarav Sharma');
  });

  it('maps a whitespace-only box to an empty term', () => {
    assert.equal(normaliseSearch('   '), '');
  });
});

describe('isSearchSettled', () => {
  it('is settled when the trimmed input already matches the debounced term', () => {
    assert.equal(isSearchSettled('Aaqib ', 'Aaqib'), true);
  });

  it('is unsettled while a new term is pending', () => {
    assert.equal(isSearchSettled('Aaq', ''), false);
  });

  it('treats an emptied box as a real change back to no search', () => {
    assert.equal(isSearchSettled('', 'Aaqib'), false);
  });
});

describe('filtersKey', () => {
  it('is stable for equal filter values', () => {
    assert.equal(filtersKey(['DRIVER', true]), filtersKey(['DRIVER', true]));
  });

  it('changes when a filter changes', () => {
    assert.notEqual(filtersKey(['DRIVER']), filtersKey(['CONDUCTOR']));
  });

  it('handles an absent deps array', () => {
    assert.equal(filtersKey(undefined), '[]');
  });
});

describe('shouldResetPage', () => {
  it('does not reset on the very first run', () => {
    assert.equal(shouldResetPage(null, { search: '', filters: '[]' }), false);
  });

  it('resets when the search term changes', () => {
    assert.equal(
      shouldResetPage({ search: '', filters: '[]' }, { search: 'Aaqib', filters: '[]' }),
      true,
      'searching from page 2 must go back to page 1',
    );
  });

  it('resets when the search is cleared', () => {
    assert.equal(
      shouldResetPage({ search: 'Aaqib', filters: '[]' }, { search: '', filters: '[]' }),
      true,
    );
  });

  it('resets when a filter changes (e.g. Drivers -> Conductors)', () => {
    assert.equal(
      shouldResetPage(
        { search: '', filters: '["drivers"]' },
        { search: '', filters: '["conductors"]' },
      ),
      true,
    );
  });

  it('does NOT reset when only the page changed', () => {
    assert.equal(
      shouldResetPage({ search: 'rah', filters: '[]' }, { search: 'rah', filters: '[]' }),
      false,
      'paging through search results must not snap back to page 1',
    );
  });

  it('preserves an active filter across a search change', () => {
    // Filters key is untouched — the caller keeps sending the same filter.
    const previous = { search: '', filters: '["ACTIVE"]' };
    const next = { search: 'rah', filters: '["ACTIVE"]' };
    assert.equal(shouldResetPage(previous, next), true);
    assert.equal(next.filters, previous.filters, 'search must not drop the filter');
  });
});

describe('stale-response protection', () => {
  it('accepts the newest request', () => {
    assert.equal(isLatestRequest(7, 7), true);
    assert.equal(isStaleResponse(7, 7), false);
  });

  it('rejects an older response that resolves late', () => {
    // "aa" (id 3) resolves after "aaqib" (id 4) — it must be dropped.
    assert.equal(isLatestRequest(3, 4), false);
    assert.equal(isStaleResponse(3, 4), true);
  });
});

describe('searchParamFor', () => {
  it('omits the parameter when there is no search', () => {
    assert.equal(searchParamFor(''), undefined);
  });

  it('sends the term when searching', () => {
    assert.equal(searchParamFor('Aaqib'), 'Aaqib');
  });
});

describe('SEARCH_DEBOUNCE_MS', () => {
  it('is a sensible mobile debounce', () => {
    assert.ok(SEARCH_DEBOUNCE_MS >= 200 && SEARCH_DEBOUNCE_MS <= 500);
  });
});
