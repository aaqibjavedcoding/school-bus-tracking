'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaginationMeta } from '@school-bus-tracking/shared-types';
import { getApiErrorMessage } from '../lib/errors';
import { createDebouncedReload, subscribeDataUpdated } from '../lib/data-updated';

const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

/**
 * Paged list hook — optimized for admin speed (batch 3E).
 *
 * Before: every reload set `loading=true` and cleared items on error, causing
 * skeleton flash and full table re-mount on pagination/search. The data-updated
 * subscription re-created on every reload change.
 *
 * After:
 * - keeps previous items while reloading (stale-while-revalidate UX, no flash)
 * - only shows skeleton on initial load (items empty)
 * - keeps items on error (no empty flash)
 * - memoizes depsKey to avoid JSON.stringify on every render
 * - debounced data-updated listener uses stable ref to avoid re-subscribing
 * - requestId guard prevents stale responses from overwriting fresh data
 */
export function usePagedResource<T>(
  loader: (page: number, search: string) => Promise<{ items: T[]; meta: PaginationMeta }>,
  deps: unknown[] = [],
) {
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

  useEffect(() => {
    setSearching(true);
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setSearching(false);
    }, 280);
    return () => window.clearTimeout(handle);
  }, [search]);

  // Memoize deps key to avoid JSON.stringify on every render
  const depsKey = useMemo(() => JSON.stringify(deps), [JSON.stringify(deps)]);

  // Reset page to 1 when search or filter deps change, BEFORE the reload
  // effect fires. Using a ref guard prevents a duplicate fetch.
  const lastQueryRef = useRef<{ search: string; deps: string } | null>(null);
  useEffect(() => {
    const next = { search: debouncedSearch, deps: depsKey };
    if (
      lastQueryRef.current &&
      (lastQueryRef.current.search !== next.search || lastQueryRef.current.deps !== next.deps)
    ) {
      setPage(1);
    }
    lastQueryRef.current = next;
  }, [debouncedSearch, depsKey]);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    // Only show full loading spinner on initial load (no items yet)
    // Otherwise keep previous data visible while fetching new page
    const isInitial = requestId.current === 1;
    if (isInitial) {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await loaderRef.current(page, debouncedSearch);
      // Stale-response guard: a slow request for an older term must never
      // overwrite the results of the newest one.
      if (!mounted.current || id !== requestId.current) return;
      setItems(result.items);
      setMeta(result.meta);
    } catch (caught) {
      if (!mounted.current || id !== requestId.current) return;
      // Keep previous items on error — no flash to empty
      setError(getApiErrorMessage(caught));
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
      }
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void reload();
  }, [reload, depsKey]);

  // A write on any screen (this one or another) refreshes this list, so "Add
  // bus" is visible on the route screen without a browser reload. Debounced so
  // a multi-step save reloads once. See `lib/data-updated`.
  // Use ref for reload to avoid re-subscribing on every reload identity change
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const debounced = createDebouncedReload(() => void reloadRef.current());
    const unsubscribe = subscribeDataUpdated(debounced.request);
    return () => {
      unsubscribe();
      debounced.cancel();
    };
  }, []);

  return {
    items,
    meta,
    page,
    setPage,
    search,
    setSearch,
    loading,
    searching,
    error,
    reload,
    setItems,
  };
}
