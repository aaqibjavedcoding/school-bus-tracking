'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginationMeta } from '@school-bus-tracking/shared-types';
import { getApiErrorMessage } from '../lib/errors';

const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

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

  // Reset page to 1 when search or filter deps change, BEFORE the reload
  // effect fires. Using a ref guard prevents a duplicate fetch.
  const lastQueryRef = useRef<{ search: string; deps: string } | null>(null);
  const depsKey = JSON.stringify(deps);
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
    setLoading(true);
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
      setItems([]);
      setError(getApiErrorMessage(caught));
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
      }
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void reload();
  }, [reload, ...deps]);

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
