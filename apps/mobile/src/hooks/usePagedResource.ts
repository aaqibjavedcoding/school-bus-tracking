import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaginationMeta } from '@school-bus-tracking/shared-types';
import { getApiErrorMessage } from '../lib/errors';

/**
 * Mobile port of the web `usePagedResource`: paginated + debounced-search
 * list state used by the school-admin CRUD screens. Keeps the same shape as
 * the web hook so the screens read identically across platforms, plus two
 * mobile-specific guarantees:
 *
 *  - **Stale-response guard.** Fast typing fires overlapping requests; only
 *    the newest one is allowed to write into state, so the visible list always
 *    matches the current query (previously a slow first request could land
 *    last and "undo" the search).
 *  - **Filter changes reset pagination.** Changing a filter (`deps`) while on
 *    page 3 used to request page 3 of the new result set and render an empty
 *    list.
 */

const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export interface PagedResource<T> {
  items: T[];
  meta: PaginationMeta;
  page: number;
  setPage: (page: number) => void;
  search: string;
  setSearch: (search: string) => void;
  /** Trimmed search actually sent to the API. */
  activeSearch: string;
  /** Clears the search box (and therefore the query) immediately. */
  clearSearch: () => void;
  loading: boolean;
  /** True between a keystroke and the debounced request being issued. */
  searching: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

export function usePagedResource<T>(
  loader: (page: number, search: string) => Promise<{ items: T[]; meta: PaginationMeta }>,
  deps: unknown[] = [],
): PagedResource<T> {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(EMPTY_META);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Debounce the raw input; `searching` drives the inline spinner.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === debouncedSearch) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      setDebouncedSearch(trimmed);
      setSearching(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [search, debouncedSearch]);

  const depsKey = JSON.stringify(deps ?? []);

  // A new query (search or filter) always restarts at page 1.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setPage(1);
  }, [debouncedSearch, depsKey]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current(page, debouncedSearch);
      if (!mounted.current || id !== requestId.current) return;
      setItems(result.items);
      setMeta(result.meta ?? EMPTY_META);
    } catch (caught) {
      if (!mounted.current || id !== requestId.current) return;
      setItems([]);
      setError(getApiErrorMessage(caught));
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
      }
    }
  }, [page, debouncedSearch, depsKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clearSearch = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setSearching(false);
  }, []);

  return useMemo(
    () => ({
      items,
      meta,
      page,
      setPage,
      search,
      setSearch,
      activeSearch: debouncedSearch,
      clearSearch,
      loading,
      searching,
      error,
      reload,
      setItems,
    }),
    [
      items,
      meta,
      page,
      search,
      debouncedSearch,
      clearSearch,
      loading,
      searching,
      error,
      reload,
    ],
  );
}
