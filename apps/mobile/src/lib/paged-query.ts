/**
 * Pure decision logic behind `usePagedResource`.
 *
 * Extracted from the hook so the rules that make search correct — debounce
 * gating, pagination reset, filter identity and stale-response rejection —
 * can be unit-tested in plain Node like the rest of `src/lib`, instead of
 * only being exercised by hand on a device.
 */

/** Debounce applied to the raw search box before a request is issued. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The exact term sent to the API: trimmed, never `undefined`. */
export function normaliseSearch(raw: string): string {
  return raw.trim();
}

/**
 * True when the debounced term already matches the raw input, i.e. there is
 * nothing to wait for. Prevents a pointless timer (and a flickering spinner)
 * when the user types and then deletes back to the same term, and prevents a
 * duplicate request for a change that only added surrounding whitespace.
 */
export function isSearchSettled(raw: string, debounced: string): boolean {
  return normaliseSearch(raw) === debounced;
}

/**
 * Stable identity for the non-search filters (`deps`). A change here means a
 * different result set, so it must reset pagination just like a new search.
 */
export function filtersKey(deps: readonly unknown[] | undefined): string {
  return JSON.stringify(deps ?? []);
}

/**
 * Whether a new query (search term or filters) requires jumping back to
 * page 1. Without this, searching from page 3 requests page 3 of a much
 * smaller result set and renders an empty list — the "search returns nothing"
 * symptom.
 */
export function shouldResetPage(
  previous: { search: string; filters: string } | null,
  next: { search: string; filters: string },
): boolean {
  if (previous === null) return false; // first run: honour the initial page
  return previous.search !== next.search || previous.filters !== next.filters;
}

/**
 * Whether a settled request may write its result into state.
 *
 * Every request takes a monotonically increasing id; only the newest one is
 * allowed to commit. This is what stops a slow response for `"aa"` from
 * landing after the fast response for `"aaqib"` and overwriting the correct,
 * newer results.
 */
export function isLatestRequest(requestId: number, latestId: number): boolean {
  return requestId === latestId;
}

/** Convenience inverse of {@link isLatestRequest}. */
export function isStaleResponse(requestId: number, latestId: number): boolean {
  return !isLatestRequest(requestId, latestId);
}

/**
 * The `search` value handed to the loader. Screens forward this straight to
 * the API client, which omits the parameter when it is empty — so clearing
 * the search box restores the plain paginated list.
 */
export function searchParamFor(debouncedSearch: string): string | undefined {
  return debouncedSearch.length > 0 ? debouncedSearch : undefined;
}
